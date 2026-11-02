// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { GithubId } from '../../shared/github-id.ts';
import type { InstallationRowId } from '../adapters/db/installation-row-id.ts';
import type { Clock } from './ports/clock.ts';
import { RoleEntries } from './role-cache-entries.ts';
import { type RoleKey, roleKeyText } from './role-key.ts';

// The role cache (E11-S04): what GitHub said a person may do in a tenant, kept for a minute so that a page that makes
// several guarded requests does not ask GitHub every time. The facts it holds are the role lookups of E11-S02 and E11-S03
// (`createOrgAdminLookup`, `createRepoAdminLookup`), in front of which it sits; the decision that uses them is the pure
// `decide` of src/server/domain/authz.ts.
//
// Only numeric ids and booleans are kept (role-key.ts), in memory, per process: a restart clears the cache, which costs
// GitHub calls and never a wrong answer. A failure is never kept and nothing is served stale when GitHub fails (a failing
// GitHub means a failing request); the only bound on how old an answer can be is the time to live.

/** How long an answer, positive or negative, is served without asking GitHub again. */
const TTL_MS = 60_000;

/** The most answers kept; past it the one used longest ago is forgotten. */
const MAX_ENTRIES = 10_000;

export interface RoleCacheOptions {
  /** Where "now" comes from: a test moves it by hand. */
  readonly clock: Clock;
  /** The most answers kept; defaults to 10 000. A positive integer. */
  readonly maxEntries?: number;
}

export interface ResolveOptions {
  /**
   * Ignore the cached answer and ask again: the answer of GitHub replaces the cached one. Routes that change data set it
   * (E11-S05), so a person who was demoted a second ago cannot still write. Defaults to false.
   */
  readonly fresh?: boolean;
}

/** A lookup that is under way. `ticket` tells which one is the current for its key: a later one displaces an earlier. */
interface Flight {
  readonly key: RoleKey;
  readonly ticket: number;
  readonly promise: Promise<boolean>;
}

export class RoleCache {
  readonly #clock: Clock;
  readonly #entries: RoleEntries;
  readonly #flights = new Map<string, Flight>();
  #tickets = 0;

  /** @throws RangeError when `maxEntries` is not a positive integer. */
  constructor(options: RoleCacheOptions) {
    this.#clock = options.clock;
    this.#entries = new RoleEntries(options.maxEntries ?? MAX_ENTRIES);
  }

  /** How many answers are kept (an answer past its time to live counts until it is looked up or pushed out). */
  get size(): number {
    return this.#entries.size;
  }

  /**
   * The answer for `key`: the cached one while it is younger than 60 s (a hit at 59.999 s, a miss at 60 s), else the
   * result of `load`, kept for the next 60 s. Positive and negative answers are kept alike.
   *
   * Single flight: while a lookup for `key` is under way, every other caller of the same key waits for that one and shares
   * its result, so 20 simultaneous requests cost GitHub one call; lookups for different keys never wait on each other.
   * `load` runs once per miss, and only a miss: whatever it costs (a GitHub call, a share of a budget) is not spent by a
   * hit or by a caller that joins one. It may throw or reject: the failure goes to everyone who waited for it, nothing is
   * kept, and the next caller asks again.
   *
   * With `fresh` the cache is not read and no lookup is joined: a new one starts, and its answer replaces the cached one
   * and displaces any lookup of the key still under way (so an older answer that arrives later cannot overwrite it). Later
   * callers without `fresh` may then join it.
   */
  resolve(key: RoleKey, load: () => Promise<boolean>, options: ResolveOptions = {}): Promise<boolean> {
    const id = roleKeyText(key);
    if (options.fresh !== true) {
      const hit = this.#entries.hit(id, this.#now());
      if (hit !== undefined) {
        return Promise.resolve(hit);
      }
      const flying = this.#flights.get(id);
      if (flying !== undefined) {
        return flying.promise;
      }
    }
    return this.#start(id, key, load);
  }

  /** Forgets every answer about the person with this numeric GitHub id, whatever the installation (logout, revoked authorization: E10-S06, E10-S07). */
  invalidateViewer(githubId: GithubId): void {
    this.#drop((key) => key.viewerGithubId === githubId);
  }

  /** Forgets every answer about the installation with this `installations.id`. */
  invalidateInstallation(installationId: InstallationRowId): void {
    this.#drop((key) => key.installationId === installationId);
  }

  /** Forgets everything. */
  invalidateAll(): void {
    this.#drop(() => true);
  }

  #now(): number {
    return this.#clock.now().getTime();
  }

  #start(id: string, key: RoleKey, load: () => Promise<boolean>): Promise<boolean> {
    this.#tickets += 1;
    const ticket = this.#tickets;
    // The age of an answer counts from the moment its question was sent: that is the latest GitHub can have said it.
    const expiresAt = this.#now() + TTL_MS;
    // Whether this lookup is still the current one of its key, which it stops being when it is displaced or invalidated.
    // A lookup that is current ends here; one that is not leaves the map as it found it.
    const settle = (): boolean => {
      const current = this.#flights.get(id)?.ticket === ticket;
      if (current) {
        this.#flights.delete(id);
      }
      return current;
    };
    // `Promise.try` turns a `load` that throws at once into a rejection too, so no failure skips the bookkeeping below.
    const promise = Promise.try(load).then(
      (allowed) => {
        if (settle()) {
          this.#entries.keep(id, { key, allowed, expiresAt });
        }
        return allowed;
      },
      (error: unknown) => {
        settle();
        throw error;
      },
    );
    this.#flights.set(id, { key, ticket, promise });
    return promise;
  }

  /** Forgets the answers and the lookups under way whose key matches. A lookup that is forgotten still answers its own callers, but keeps nothing. */
  #drop(matches: (key: RoleKey) => boolean): void {
    this.#entries.drop(matches);
    for (const [id, flight] of this.#flights) {
      if (matches(flight.key)) {
        this.#flights.delete(id);
      }
    }
  }
}

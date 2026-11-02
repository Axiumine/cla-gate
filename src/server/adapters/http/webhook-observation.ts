// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Giovanni Manzoni
import type { WebhookDelivery } from '../github/webhook-schemas.ts';
import { AppError } from './errors.ts';
import type { WebhookAnswer } from './webhook-answer.ts';
import type { WebhookEnvelope } from './webhook-envelope.ts';

// What is known of a webhook request while it advances (E06-S07), kept for the one line it ends with (`webhook.received`,
// see webhook-log.ts). Everything here is a constant of this server, a header once it has passed its check, a numeric id of
// the payload, or an action that has the shape of a GitHub action: nothing a delivery chose as free text.

/** What became of a delivery: a job was queued, nothing was to be done (a ping included), it was recorded before, or it was refused. */
type Outcome = 'accepted' | 'ignored' | 'duplicate' | 'rejected';

/** What GitHub calls an action: `opened`, `ready_for_review`. Anything else is not copied into a log line. */
const LOGGABLE_ACTION = /^[a-z_]{1,64}$/;

/** The fields of the `webhook.received` line. */
export interface ReceivedFields {
  readonly event: string | null;
  readonly action: string | null;
  readonly deliveryId: string | null;
  readonly githubInstallationId: number | null;
  readonly outcome: Outcome;
  /** An ignore reason, an error code, or `null` for a delivery that was accepted or was a duplicate. */
  readonly reason: string | null;
  readonly durationMs: number;
}

/** The installation a payload names; `github_app_authorization` is the one event that names none. */
function installationIdOf(delivery: WebhookDelivery): number | null {
  return 'installation' in delivery.payload ? delivery.payload.installation.id : null;
}

/**
 * What is known of one request, filled in as the request advances. A request that ends before anything says otherwise
 * was refused (`request_failed`), so a failure nobody described still gets an honest line.
 */
export class Observation {
  #event: string | null = null;
  #action: string | null = null;
  #deliveryId: string | null = null;
  #githubInstallationId: number | null = null;
  #outcome: Outcome = 'rejected';
  #reason: string | null = 'request_failed';

  /** The headers have passed their checks: the event name is lower-case letters and underscores, the delivery id a UUID. */
  sawEnvelope(envelope: WebhookEnvelope): void {
    this.#event = envelope.event;
    this.#deliveryId = envelope.deliveryId;
  }

  /** The payload has passed the schema of its event. */
  sawPayload(delivery: WebhookDelivery): void {
    this.#action = LOGGABLE_ACTION.test(delivery.payload.action) ? delivery.payload.action : null;
    this.#githubInstallationId = installationIdOf(delivery);
  }

  /** The delivery was answered with `body`: the outcome and the reason are what the body says. */
  answered(body: WebhookAnswer['body']): void {
    switch (body.status) {
      case 'pong':
        this.#outcome = 'ignored';
        this.#reason = 'ping';
        break;
      case 'ignored':
        this.#outcome = 'ignored';
        this.#reason = body.reason;
        break;
      case 'duplicate':
        this.#outcome = 'duplicate';
        this.#reason = null;
        break;
      case 'accepted':
        this.#outcome = 'accepted';
        this.#reason = null;
        break;
    }
  }

  /** The request failed: the reason is the stable code of an {@link AppError}, and a constant for any other failure. */
  refused(error: unknown): void {
    this.#outcome = 'rejected';
    this.#reason = error instanceof AppError ? error.code : 'unexpected_error';
  }

  fields(durationMs: number): ReceivedFields {
    return {
      event: this.#event,
      action: this.#action,
      deliveryId: this.#deliveryId,
      githubInstallationId: this.#githubInstallationId,
      outcome: this.#outcome,
      reason: this.#reason,
      durationMs,
    };
  }
}

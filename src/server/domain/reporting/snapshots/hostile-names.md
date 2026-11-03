# Hostile names, rendered (E09-S01)

## renderName over HOSTILE_NAMES

1. `=HYPERLINK("http://evil.example","x")`
2. `+1+1`
3. `-2+3`
4. `@⟦ZWSP⟧SUM(A1)`
5. `=cmd|' /C calc'!A0`
6. `[x](http://evil.example)`
7. `<img src=x onerror=alert(1)>`
8. `@⟦ZWSP⟧everyone`
9. `@⟦ZWSP⟧here`
10. `@⟦ZWSP⟧org/team`
11. `#⟦ZWSP⟧1`
12. `org/repo#⟦ZWSP⟧1`
13. `GH-1`
14. `'; drop table users;--`
15. `![i](http://t.example/p.png)`
16. `<script>alert(1)</script>`
17. `<⟦ZWSP⟧!-- cla-platform:license/cla:v1 -->`
18. ````` ` `` ``` ```` `````
19. `a | b`
20. `&#⟦ZWSP⟧64;octocat`
21. `trailing backslash\`
22. `/recheck`
23. `javascript:alert(1)`
24. `مرحبا بالعالم`
25. `👩‍👩‍👧‍👦`
26. `zero⟦ZWSP⟧width‍joiner`
27. `nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn…`

## renderName over HOSTILE_CONTROL_NAMES

1. `- [x] Signed`
2. `#⟦ZWSP⟧#⟦ZWSP⟧ Passed`
3. `(unnamed)`
4. `�`
5. `exe.live`
6. `lineseparator`
7. `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…`

## neutraliseText over HOSTILE_NAMES

1. =HYPERLINK\("http://evil\.example","x"\)
2. \+1\+1
3. \-2\+3
4. @⟦ZWSP⟧SUM\(A1\)
5. =cmd\|' /C calc'\!A0
6. \[x\]\(http://evil\.example\)
7. \<img src=x onerror=alert\(1\)\>
8. @⟦ZWSP⟧everyone
9. @⟦ZWSP⟧here
10. @⟦ZWSP⟧org/team
11. \#⟦ZWSP⟧1
12. org/repo\#⟦ZWSP⟧1
13. GH\-1
14. '; drop table users;\-\-
15. \!\[i\]\(http://t\.example/p\.png\)
16. \<script\>alert\(1\)\</script\>
17. \<\!\-\- cla\-platform:license/cla:v1 \-\-\>
18. \` \`\` \`\`\` \`\`\`\`
19. a \| b
20. \&\#⟦ZWSP⟧64;octocat
21. trailing backslash\\
22. /recheck
23. javascript:alert\(1\)
24. مرحبا بالعالم
25. 👩‍👩‍👧‍👦
26. zero⟦ZWSP⟧width‍joiner
27. nnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn

## neutraliseText over HOSTILE_CONTROL_NAMES

1.  \- \[x\] Signed
2.  \#⟦ZWSP⟧\#⟦ZWSP⟧ Passed
3. 
4. �
5. exe\.live
6. line separator
7. xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Environment notice repair

## Source and scope

Personal fork: https://github.com/lisihao/dsh-purge. Base: Community v1.6.38, commit 3a897dd977dbb222e46bae140f2e7d37b456d13c (MIT). This UI repair changes no host patch, model prompt, permission, tool, environment readiness, or skip setting.

## Behavior

The old EnvAdaptSendGate used dshp-auth-* classes with no matching CSS and rendered from shell.overlay. Its open state was not cleared when the current conversation or preset changed. The repaired component uses its own dshpp-env-* rules and the published conversation.composer.dock slot. Dismiss and Escape hide the notice without marking the environment ready; a subsequent red-team send still checks readiness. A known current preset takes precedence over unrelated DOM labels.

The existing dsh-purge-rightbar adapter continues to render the keyed main page. This fork omits the duplicate left rail registration rather than editing installed JavaScript after each update.

## Upgrade boundary

Pins are package.json / package-lock.json and the versioned GitHub Release. Build input is packages/purge-panel/src; root client.js is committed build output. Carried changes are the composer-scoped reminder, current-preset precedence, existing rightbar entry preservation, and publication/updater URLs pointing to this personal fork. Re-run the built-client regression and inspect the installed UI after any baseline change.

No changes are submitted to the former community repository or official DSH repository. No host patch application, app rebuild, model capability test, or red-team operation is part of this repair.

/**
 * The one place the in-app APK updater's distribution settings live.
 *
 * GitHub Releases is the entire update backend: the latest published release
 * is the version manifest (tag → version, assets → APK), so there is no
 * second manifest file, no custom server, and no secret of any kind in this
 * file — public releases need no authentication, and embedding a token in an
 * APK would ship it to every user. Changing the distribution repository is a
 * one-line edit here; nothing else in the codebase names an owner, a repo, or
 * a download host.
 */

export const UPDATE_CONFIG = {
  /** GitHub owner of the repository that publishes releases. */
  githubOwner: 'Lanx10',
  /** GitHub repository name (must be public for unauthenticated access). */
  githubRepository: 'kondukt2',
  /** Release tags are `<prefix><semver>`: `v1.0.0`, `v1.1.0`, … */
  releaseTagPrefix: 'v',
  /** Minimum gap between *automatic* checks (start-up / foreground). */
  automaticCheckIntervalMs: 6 * 60 * 60 * 1000,
  /** Whether a release's `minimumVersion` may force an update (no "Later"). */
  allowMandatoryUpdates: true,
  /** Timeout for the GitHub API metadata request (downloads have their own). */
  requestTimeoutMs: 15_000,
} as const;

/** The single source of truth for "what is the latest release?". */
export function latestReleaseApiUrl(): string {
  const { githubOwner, githubRepository } = UPDATE_CONFIG;
  return `https://api.github.com/repos/${githubOwner}/${githubRepository}/releases/latest`;
}

/**
 * The only host an APK may be downloaded from: this repository's own release
 * assets. `parseRelease` rejects anything that does not start with this, so a
 * tampered or foreign manifest can never redirect the downloader.
 */
export function trustedDownloadUrlPrefix(): string {
  const { githubOwner, githubRepository } = UPDATE_CONFIG;
  return `https://github.com/${githubOwner}/${githubRepository}/releases/download/`;
}

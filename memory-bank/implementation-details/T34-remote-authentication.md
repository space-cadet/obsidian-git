# T34: Remote Authentication Architecture and Evidence

*Created: 2026-08-10 22:34:02 IST*
*Last Updated: 2026-08-10 22:34:02 IST*

## Current Transport Boundary

`GitHttpClient` uses Obsidian `requestUrl` and sends HTTPS Git credentials as
HTTP Basic authentication. `GitManager.testRemoteConnection()` calls
`git.listServerRefs` directly, so it tests a remote without accessing the
vault filesystem, creating `.git`, cloning, or changing a remote.

The relevant separation is:

```text
Settings Test -> credential/account validation -> repository access check
              -> Git smart-HTTP ref check -> success/error notice

Clone/Pull/Push -> existing GitManager operations -> local repository required
```

## Session Findings

1. The published `dev` artifact for `22857f1` contains the new read-only Test
   Connection path. The earlier Android "No git repository configured" notices
   came from an older installed `main.js`.
2. Once the current bundle was installed, Android reached GitHub and returned
   HTTP 401. That distinguishes deployment/repository lifecycle from
   authentication.
3. The supplied token was tested only through read-only endpoints. GitHub
   returned HTTP 401 for account API, repository API, and Git smart HTTP.
   This is token rejection before repository-permission evaluation. The raw
   token was not retained and must be revoked because it was exposed in chat.

## T34a Diagnostic Design

For a recognized GitHub HTTPS URL:

1. Trim the URL and credentials for transport only; never log their values.
2. Request `GET /user` with a Bearer token.
   - HTTP 401: token invalid, expired, or revoked.
3. Request `GET /repos/{owner}/{repo}`.
   - inaccessible/denied: token lacks access to the selected repository.
4. Run the existing read-only Git ref advertisement request.
   - failure here after the API checks: report Git HTTPS transport rejection.

For other hosts, retain the generic Git smart-HTTP test and describe it as a
remote credential/transport check rather than a GitHub account check.

## T34b Device-Flow Boundary

GitHub device authorization is an optional later sign-in layer, not a
replacement for GitManager. It should obtain a GitHub App user token through a
displayed verification code and browser approval, then feed the resulting token
into the existing HTTPS Git credential path. It must provide cancellation,
expiry/recovery, sign-out, and explicit at-rest-storage limitations.

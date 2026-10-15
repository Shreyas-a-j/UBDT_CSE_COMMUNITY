// OpenNext Cloudflare adapter configuration.
// Generated for the UBDT CSE Community deployment as a Cloudflare Worker.
// This file is the source of truth for the adapter; it is committed so the
// build is deterministic and does not need to be re-migrated on every run.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: r2IncrementalCache,
});
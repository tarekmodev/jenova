// Worker entrypoint. BullMQ processors land in M1; until then an active
// timer keeps the event loop (and the staging compose unit) alive instead
// of exiting into a restart loop.
setInterval(() => {
  // heartbeat no-op until processors register
}, 60_000);

export {};

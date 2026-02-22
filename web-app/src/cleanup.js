const { getIdleSessions, stopGameForUser } = require('./k8s');

const IDLE_TIMEOUT_MINUTES = parseInt(process.env.IDLE_TIMEOUT_MINUTES || '30', 10);

async function main() {
  console.log(`Checking for sessions idle > ${IDLE_TIMEOUT_MINUTES} minutes...`);

  const idle = getIdleSessions(IDLE_TIMEOUT_MINUTES);
  console.log(`Found ${idle.length} idle session(s).`);

  for (const session of idle) {
    try {
      console.log(`Stopping session ${session.id} for user ${session.user_id} (idle since ${session.last_activity})`);
      await stopGameForUser(session.user_id);
    } catch (err) {
      console.error(`Failed to stop session ${session.id}:`, err);
    }
  }

  console.log('Cleanup complete.');
  process.exit(0);
}

main();

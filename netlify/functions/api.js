const serverless = require('serverless-http');
const app = require('../../server');

const handler = serverless(app);

module.exports.handler = async (event, context) => {
  const db = app.get('db');
  
  // Wait for all collections to finish loading (e.g., establishing connection to MongoDB Atlas)
  if (db) {
    await Promise.all([
      db.users.loadPromise,
      db.keys.loadPromise,
      db.analytics.loadPromise,
      db.notifications.loadPromise,
      db.logs.loadPromise
    ]);
  }
  
  return handler(event, context);
};

const fs = require('fs');
const path = require('path');

let MongoClient = null;
try {
  MongoClient = require('mongodb').MongoClient;
} catch (_) {}

// MongoDB connection settings
let mongoClient = null;
let mongoDb = null;
let useMongo = false;

const uri = process.env.MONGODB_URI;
if (uri && MongoClient) {
  useMongo = true;
  mongoClient = new MongoClient(uri);
}

class JSONCollection {
  constructor(name, filePath) {
    this.name = name;
    this.filePath = filePath;
    this.data = [];
    this.loadPromise = this.load();
  }

  async load() {
    if (useMongo) {
      try {
        if (!mongoDb) {
          await mongoClient.connect();
          mongoDb = mongoClient.db();
          console.log('[Database] Connected to MongoDB Atlas');
        }
        const collection = mongoDb.collection(this.name);
        const docs = await collection.find({}).toArray();
        this.data = docs;
        console.log(`[Database] Loaded ${this.data.length} docs from MongoDB: ${this.name}`);
      } catch (err) {
        console.error(`[Database] Error connecting/loading MongoDB, falling back to local storage:`, err);
        this.loadLocal();
      }
    } else {
      this.loadLocal();
    }
  }

  loadLocal() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(fileContent);
      } else {
        this.data = [];
        this.saveLocal();
      }
    } catch (err) {
      console.error(`Error loading database file ${this.filePath}:`, err);
      this.data = [];
    }
  }

  save() {
    if (useMongo && mongoDb) {
      const collection = mongoDb.collection(this.name);
      // Overwrite the MongoDB collection in background to sync changes
      collection.deleteMany({}).then(() => {
        if (this.data.length > 0) {
          collection.insertMany(this.data).catch(err => {
            console.error(`[Database] Error inserting into MongoDB for ${this.name}:`, err);
          });
        }
      }).catch(err => {
        console.error(`[Database] Error syncing MongoDB for ${this.name}:`, err);
      });
    } else {
      this.saveLocal();
    }
  }

  saveLocal() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (err) {
      console.error(`Error saving database file ${this.filePath}:`, err);
    }
  }

  find(query = {}) {
    return this.data.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  findOne(query = {}) {
    return this.data.find(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  insert(doc) {
    const newDoc = { id: Math.random().toString(36).substring(2, 9), ...doc, createdAt: Date.now() };
    this.data.push(newDoc);
    this.save();
    return newDoc;
  }

  update(query, updateDoc) {
    let updatedCount = 0;
    this.data = this.data.map(item => {
      let matches = true;
      for (const key in query) {
        if (item[key] !== query[key]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        updatedCount++;
        return { ...item, ...updateDoc, updatedAt: Date.now() };
      }
      return item;
    });
    if (updatedCount > 0) {
      this.save();
    }
    return updatedCount;
  }

  delete(query) {
    const initialLength = this.data.length;
    this.data = this.data.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return true;
      }
      return false;
    });
    const deletedCount = initialLength - this.data.length;
    if (deletedCount > 0) {
      this.save();
    }
    return deletedCount;
  }
}

class Database {
  constructor(dbDir) {
    this.users = new JSONCollection('users', path.join(dbDir, 'users.json'));
    this.keys = new JSONCollection('keys', path.join(dbDir, 'keys.json'));
    this.analytics = new JSONCollection('analytics', path.join(dbDir, 'analytics.json'));
    this.notifications = new JSONCollection('notifications', path.join(dbDir, 'notifications.json'));
    this.logs = new JSONCollection('logs', path.join(dbDir, 'logs.json'));
    
    // Seed default admin once all collections load
    Promise.all([
      this.users.loadPromise,
      this.keys.loadPromise,
      this.analytics.loadPromise,
      this.notifications.loadPromise,
      this.logs.loadPromise
    ]).then(() => {
      this.initDefaults();
    });
  }

  initDefaults() {
    const adminExists = this.users.findOne({ role: 'admin' });
    if (!adminExists) {
      this.users.insert({
        id: 'admin@chronocode.com',
        email: 'admin@chronocode.com',
        name: 'ChronoCode Admin',
        role: 'admin',
        status: 'active',
        picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80',
        platformInfo: 'Server Default',
        lastActive: Date.now()
      });
      console.log('Seeded default administrator account: admin@chronocode.com');
    }
  }
}

module.exports = (dbDir) => new Database(dbDir);

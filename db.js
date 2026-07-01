const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let MongoClient = null;
try {
  MongoClient = require('mongodb').MongoClient;
} catch (_) {}

// MongoDB connection settings
let mongoClient = null;
let mongoDb = null;
let useMongo = false;
let mongoConnected = false;

const uri = process.env.MONGODB_URI;
if (uri && MongoClient) {
  useMongo = true;
  mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
}

class JSONCollection {
  constructor(name, filePath) {
    this.name = name;
    this.filePath = filePath;
    this.data = [];
    this._saveLock = false;
    this._pendingSave = false;
    this.loadPromise = this.load();
  }

  async load() {
    if (useMongo) {
      try {
        if (!mongoDb) {
          if (!mongoConnected) {
            await mongoClient.connect();
            mongoConnected = true;
          }
          mongoDb = mongoClient.db();
          console.log('[Database] Connected to MongoDB Atlas');
        }
        const collection = mongoDb.collection(this.name);
        const docs = await collection.find({}).toArray();
        this.data = docs;
        console.log(`[Database] Loaded ${this.data.length} docs from MongoDB: ${this.name}`);
      } catch (err) {
        console.error(`[Database] MongoDB unavailable, using local storage: ${err.message}`);
        mongoDb = null;
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
        console.log(`[Database] Loaded ${this.data.length} docs from local: ${this.name}`);
      } else {
        this.data = [];
        this.saveLocal();
      }
    } catch (err) {
      console.error(`[Database] Error loading ${this.filePath}: ${err.message}`);
      // Attempt to recover from backup
      const backupPath = this.filePath + '.bak';
      try {
        if (fs.existsSync(backupPath)) {
          const backupContent = fs.readFileSync(backupPath, 'utf-8');
          this.data = JSON.parse(backupContent);
          console.log(`[Database] Recovered ${this.data.length} docs from backup: ${this.name}`);
          // Restore the backup as the main file
          this.saveLocal();
        } else {
          console.error(`[Database] No backup found. Starting with empty collection: ${this.name}`);
          this.data = [];
        }
      } catch (backupErr) {
        console.error(`[Database] Backup recovery also failed: ${backupErr.message}`);
        this.data = [];
      }
    }
  }

  save() {
    if (useMongo && mongoDb) {
      this._saveMongo();
    } else {
      this.saveLocal();
    }
  }

  async _saveMongo() {
    if (this._saveLock) {
      this._pendingSave = true;
      return;
    }
    this._saveLock = true;
    try {
      const collection = mongoDb.collection(this.name);
      // Use replaceOne with upsert for atomic operations instead of deleteAll+insertAll
      // For simplicity and safety, we do a full replace but handle errors properly
      await collection.deleteMany({});
      if (this.data.length > 0) {
        // Insert in batches of 100 to avoid oversized operations
        for (let i = 0; i < this.data.length; i += 100) {
          const batch = this.data.slice(i, i + 100);
          await collection.insertMany(batch);
        }
      }
    } catch (err) {
      console.error(`[Database] MongoDB save failed for ${this.name}: ${err.message}`);
    } finally {
      this._saveLock = false;
      if (this._pendingSave) {
        this._pendingSave = false;
        this._saveMongo();
      }
    }
  }

  saveLocal() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      // Write to backup first, then atomic rename
      const tempPath = this.filePath + '.tmp';
      const backupPath = this.filePath + '.bak';
      const dataStr = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(tempPath, dataStr, 'utf-8');
      // If main file exists, backup it first
      if (fs.existsSync(this.filePath)) {
        try { fs.copyFileSync(this.filePath, backupPath); } catch (_) {}
      }
      // Atomic rename (on most filesystems)
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      console.error(`[Database] Error saving ${this.filePath}: ${err.message}`);
    }
  }

  find(query = {}) {
    if (!this.data) return [];
    return this.data.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  findOne(query = {}) {
    if (!this.data) return undefined;
    return this.data.find(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  insert(doc) {
    if (!this.data) this.data = [];
    const newDoc = {
      id: crypto.randomBytes(8).toString('hex'),
      ...doc,
      createdAt: doc.createdAt || Date.now()
    };
    this.data.push(newDoc);
    this.save();
    return newDoc;
  }

  update(query, updateDoc) {
    if (!this.data) return 0;
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
    if (!this.data) return 0;
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
    this.plans = new JSONCollection('plans', path.join(dbDir, 'plans.json'));

    // Seed default admin once all collections load
    this.ready = Promise.all([
      this.users.loadPromise,
      this.keys.loadPromise,
      this.analytics.loadPromise,
      this.notifications.loadPromise,
      this.logs.loadPromise,
      this.plans.loadPromise
    ]).then(() => {
      this.initDefaults();
    }).catch(err => {
      console.error('[Database] Initialization error:', err.message);
    });
  }

  initDefaults() {
    try {
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

      // Seed default plans if empty
      const plansList = this.plans.find();
      if (plansList.length === 0) {
        this.plans.insert({
          id: 'starter',
          name: 'Starter Plan',
          duration: 'Lifetime',
          price: 0,
          discountedPrice: 0,
          discountOff: '0% OFF',
          features: {
            restoreSnapshot: false,
            diffSnapshot: false,
            exportSnapshot: false,
            importSnapshot: false,
            cleanupSnapshot: false,
            maxFileSize: 10485760, // 10MB
            maxSnapshotSize: 52428800 // 50MB
          }
        });
        this.plans.insert({
          id: 'pro',
          name: 'Pro License',
          duration: 'Lifetime Key',
          price: 49,
          discountedPrice: 29,
          discountOff: '40% OFF',
          features: {
            restoreSnapshot: true,
            diffSnapshot: true,
            exportSnapshot: true,
            importSnapshot: true,
            cleanupSnapshot: true,
            maxFileSize: 104857600, // 100MB
            maxSnapshotSize: 524288000 // 500MB
          }
        });
        this.plans.insert({
          id: 'premium',
          name: 'Premium Subscription',
          duration: 'Monthly',
          price: 19,
          discountedPrice: 9.99,
          discountOff: '47% OFF',
          features: {
            restoreSnapshot: true,
            diffSnapshot: true,
            exportSnapshot: true,
            importSnapshot: true,
            cleanupSnapshot: true,
            maxFileSize: 524288000, // 500MB
            maxSnapshotSize: 2147483648 // 2GB
          }
        });
        console.log('Seeded default subscription plans.');
      }
    } catch (err) {
      console.error('[Database] Error seeding admin/plans:', err.message);
    }
  }
}

module.exports = (dbDir) => new Database(dbDir);

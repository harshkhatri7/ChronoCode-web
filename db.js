const fs = require('fs');
const path = require('path');

class JSONCollection {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = [];
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const fileContent = fs.readFileSync(this.filePath, 'utf-8');
        this.data = JSON.parse(fileContent);
      } else {
        this.data = [];
        this.save();
      }
    } catch (err) {
      console.error(`Error loading database file ${this.filePath}:`, err);
      this.data = [];
    }
  }

  save() {
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
    this.load();
    return this.data.filter(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  findOne(query = {}) {
    this.load();
    return this.data.find(item => {
      for (const key in query) {
        if (item[key] !== query[key]) return false;
      }
      return true;
    });
  }

  insert(doc) {
    this.load();
    const newDoc = { id: Math.random().toString(36).substring(2, 9), ...doc, createdAt: Date.now() };
    this.data.push(newDoc);
    this.save();
    return newDoc;
  }

  update(query, updateDoc) {
    this.load();
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
    this.load();
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
    this.users = new JSONCollection(path.join(dbDir, 'users.json'));
    this.keys = new JSONCollection(path.join(dbDir, 'keys.json'));
    this.analytics = new JSONCollection(path.join(dbDir, 'analytics.json'));
    this.notifications = new JSONCollection(path.join(dbDir, 'notifications.json'));
    this.logs = new JSONCollection(path.join(dbDir, 'logs.json'));
    this.initDefaults();
  }

  initDefaults() {
    // Seed default admin if none exists
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

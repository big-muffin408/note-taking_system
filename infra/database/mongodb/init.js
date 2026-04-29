db = db.getSiblingDB('notes');

db.createCollection('documents');
db.createCollection('versions');
db.createCollection('collaboration_events');

db.documents.createIndex({ ownerId: 1, updatedAt: -1 });
db.versions.createIndex({ documentId: 1, createdAt: -1 });
db.collaboration_events.createIndex({ documentId: 1, createdAt: -1 });

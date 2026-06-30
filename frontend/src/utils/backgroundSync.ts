'use client';

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface PendingAction {
  id: string;
  type: 'application' | 'message';
  endpoint: string;
  method: string;
  body: any;
  headers: Record<string, string>;
  timestamp: number;
  retries: number;
}

interface SyncDB extends DBSchema {
  pending: {
    key: string;
    value: PendingAction;
    indexes: { 'by-type': string; 'by-timestamp': number };
  };
}

const DB_NAME = 'stellarmarket-sync';
const DB_VERSION = 1;
const STORE_NAME = 'pending';

let dbPromise: Promise<IDBPDatabase<SyncDB>> | null = null;

async function getDB(): Promise<IDBPDatabase<SyncDB>> {
  if (!dbPromise) {
    dbPromise = openDB<SyncDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('by-type', 'type');
          store.createIndex('by-timestamp', 'timestamp');
        }
      },
    });
  }
  return dbPromise;
}

export async function queueAction(
  type: 'application' | 'message',
  endpoint: string,
  method: string,
  body: any,
  headers: Record<string, string> = {}
): Promise<string> {
  const db = await getDB();
  const id = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const action: PendingAction = {
    id,
    type,
    endpoint,
    method,
    body,
    headers,
    timestamp: Date.now(),
    retries: 0,
  };

  await db.add(STORE_NAME, action);

  // Register background sync if supported
  if ('serviceWorker' in navigator && 'sync' in ServiceWorkerRegistration.prototype) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register(`pending-${type}`);
    } catch (error) {
      console.error('Error registering background sync:', error);
    }
  }

  return id;
}

export async function getPendingActions(type?: 'application' | 'message'): Promise<PendingAction[]> {
  const db = await getDB();

  if (type) {
    return db.getAllFromIndex(STORE_NAME, 'by-type', type);
  }

  return db.getAll(STORE_NAME);
}

export async function getPendingCount(): Promise<number> {
  const db = await getDB();
  return db.count(STORE_NAME);
}

export async function removeAction(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, id);
}

export async function updateActionRetry(id: string): Promise<void> {
  const db = await getDB();
  const action = await db.get(STORE_NAME, id);

  if (action) {
    action.retries += 1;
    await db.put(STORE_NAME, action);
  }
}

export async function replayPendingActions(): Promise<void> {
  const actions = await getPendingActions();

  for (const action of actions) {
    try {
      const response = await fetch(action.endpoint, {
        method: action.method,
        headers: {
          'Content-Type': 'application/json',
          ...action.headers,
        },
        body: JSON.stringify(action.body),
      });

      if (response.ok) {
        // Success - remove from queue
        await removeAction(action.id);
      } else if (response.status >= 400 && response.status < 500) {
        // Client error - don't retry, remove from queue
        console.error(`Action ${action.id} failed with client error:`, response.status);
        await removeAction(action.id);
      } else {
        // Server error - update retry count
        await updateActionRetry(action.id);
      }
    } catch (error) {
      console.error(`Error replaying action ${action.id}:`, error);
      await updateActionRetry(action.id);
    }
  }
}

// Helper to check if an action should be queued (offline or failed)
export function shouldQueueAction(): boolean {
  return !navigator.onLine;
}

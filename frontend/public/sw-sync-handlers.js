// Background sync handlers for pending applications and messages
// This file is imported by the main service worker

self.addEventListener("sync", async (event) => {
  console.log("[SW] Sync event:", event.tag);

  if (event.tag === "pending-application") {
    event.waitUntil(syncPendingActions("application"));
  } else if (event.tag === "pending-message") {
    event.waitUntil(syncPendingActions("message"));
  }
});

async function syncPendingActions(type) {
  console.log("[SW] Syncing pending actions:", type);

  try {
    const db = await openDB();
    const actions = await getActionsByType(db, type);

    for (const action of actions) {
      try {
        const response = await fetch(action.endpoint, {
          method: action.method,
          headers: {
            "Content-Type": "application/json",
            ...action.headers,
          },
          body: JSON.stringify(action.body),
        });

        if (response.ok) {
          await deleteAction(db, action.id);
          const title =
            type === "application" ? "Application Submitted" : "Message Sent";
          const body =
            type === "application"
              ? "Your job application has been submitted successfully."
              : "Your message has been sent successfully.";

          await self.registration.showNotification(title, {
            body,
            icon: "/icon-192.png",
            badge: "/favicon.svg",
          });
        } else if (response.status >= 400 && response.status < 500) {
          // Client error - don't retry
          await deleteAction(db, action.id);
        } else {
          // Server error - increment retry
          await incrementRetry(db, action.id);
        }
      } catch (error) {
        console.error("[SW] Error syncing action:", error);
        await incrementRetry(db, action.id);
      }
    }
  } catch (error) {
    console.error("[SW] Error in syncPendingActions:", error);
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("stellarmarket-sync", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getActionsByType(db, type) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", "readonly");
    const store = tx.objectStore("pending");
    const index = store.index("by-type");
    const request = index.getAll(type);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function deleteAction(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", "readwrite");
    const store = tx.objectStore("pending");
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function incrementRetry(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("pending", "readwrite");
    const store = tx.objectStore("pending");
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const action = getRequest.result;
      if (action) {
        action.retries += 1;
        const putRequest = store.put(action);
        putRequest.onsuccess = () => resolve();
        putRequest.onerror = () => reject(putRequest.error);
      } else {
        resolve();
      }
    };
    getRequest.onerror = () => reject(getRequest.error);
  });
}

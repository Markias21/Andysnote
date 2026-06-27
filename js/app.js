console.log("app.js loaded");

const storage = new LocalStorageProvider();

storage.init();

window.storage = storage;
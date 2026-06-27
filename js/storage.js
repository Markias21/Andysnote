
console.log("storage.js loaded");
class StorageProvider {

    async init() {
        throw new Error("Not implemented");
    }

    async loadTree() {
        throw new Error("Not implemented");
    }

    async openDocument(id) {
        throw new Error("Not implemented");
    }

    async saveDocument(id, content) {
        throw new Error("Not implemented");
    }

    async createDocument(parentId, name) {
        throw new Error("Not implemented");
    }

    async renameDocument(id, name) {
        throw new Error("Not implemented");
    }

    async deleteDocument(id) {
        throw new Error("Not implemented");
    }

}

window.StorageProvider = StorageProvider;
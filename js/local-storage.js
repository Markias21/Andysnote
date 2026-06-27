
class LocalStorageProvider extends StorageProvider {

    async init() {
        console.log("[LocalStorage] init");
    }

}

window.LocalStorageProvider = LocalStorageProvider;
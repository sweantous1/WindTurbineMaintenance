export interface ElectronAPI {
  getAppVersion: () => Promise<string>
  platform: string
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

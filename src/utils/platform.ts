/** Whether the app is running inside the Android build's WebView. */
export function isAndroid(): boolean {
  return /android/i.test(navigator.userAgent);
}

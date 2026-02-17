export function getSettings() {
   return JSON.parse(localStorage.getItem("settings") || "{}");
}
export function setSettings(data) {
   localStorage.setItem("settings", JSON.stringify(data));
}
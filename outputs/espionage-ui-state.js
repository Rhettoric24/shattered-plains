export function syncEspionageControlLock(controls, networkLocked) {
  if (!controls) return;
  controls.classList.toggle("network-locked", networkLocked);
  controls.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = networkLocked;
  });
}

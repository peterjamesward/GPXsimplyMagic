import type { AppView } from "./appView";

export type RideControlElements = Readonly<{
  playButton: HTMLButtonElement;
  progress: HTMLInputElement;
  speed: HTMLSelectElement;
  readout: HTMLOutputElement;
}>;

export const renderRideControls = (
  elements: RideControlElements,
  ride: AppView["ride"],
): void => {
  const { playButton, progress, speed, readout } = elements;
  const buttonLabel = ride.buttonLabel;
  const pressed = String(ride.isPressed);
  const progressValue = String(ride.progress);
  const speedValue = String(ride.speedKilometersPerHour);

  if (playButton.disabled !== ride.isDisabled) playButton.disabled = ride.isDisabled;
  if (playButton.textContent !== buttonLabel) playButton.textContent = buttonLabel;
  if (playButton.getAttribute("aria-label") !== buttonLabel) playButton.setAttribute("aria-label", buttonLabel);
  if (playButton.getAttribute("aria-pressed") !== pressed) playButton.setAttribute("aria-pressed", pressed);
  if (progress.disabled !== ride.isDisabled) progress.disabled = ride.isDisabled;
  if (progress.value !== progressValue) progress.value = progressValue;
  if (speed.disabled !== ride.isDisabled) speed.disabled = ride.isDisabled;
  if (speed.value !== speedValue) speed.value = speedValue;
  if (readout.textContent !== ride.readout) readout.textContent = ride.readout;
};
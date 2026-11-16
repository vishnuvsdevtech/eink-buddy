# E-Paper Buddy

The Keychain Buddy pixel pet, rebuilt for **e-paper**: a 2.9" 296×128 1-bit
panel where the image persists with the power off.

**Live:** https://vishnuvsdevtech.github.io/eink-buddy/
**OLED version:** https://vishnuvsdevtech.github.io/keychain-buddy/

## Why a separate build

An OLED must be driven continuously or it goes dark. An e-paper pixel is
**bistable** — once set, it holds with the power removed. That single fact
changes the product: the pet stops being something that animates and becomes
something that *changes occasionally*.

This page exists to show the **refresh model**, which is the part people
underestimate:

| Operation | Cost | Why |
|---|---|---|
| Hold an image | 0 mJ | physics, not electronics |
| Partial refresh | ~400 ms, ~15 mA | rewrites changed pixels; leaves ghosting |
| Full refresh | ~2400 ms, ~20 mA | inverts the whole panel to clear ghosting |
| Deep sleep | ~9 µA | MCU only; the panel draws nothing |

Refreshes are simulated, not smoothed into an animation — including the
black/white/invert flash of a full refresh and the faint ghost a partial
refresh leaves behind.

## Shared renderer

`assets/buddy-core.js` is the same file the OLED build uses. The face is drawn
at its native 128×64 and **blitted at integer scale 2** to fill 296×128, so no
geometry constant changed. `composeFace()` / `blitScaled()` are the additions.

2.9" was chosen over 2.13" deliberately: 128×64 scales to 296×128 at an exact
integer, whereas 250×122 would need resampling and fuzz the pixel art.

## Controls

Tap the panel (or click **Boop**), press **Shake**, **Sleep / Wake**, or
**Force full refresh**. Space boops, `S` shakes.

## Status

Simulator only. No hardware built — the firmware variant (GxEPD2, SPI, 4–5
wires) is not written yet.

## Honest caveat

"No power" is an overstatement. E-paper needs nothing to hold an image, but a
refresh costs 15–20 mA for a second or more, the driver idles in the tens of
microamps, and the MCU still wakes on a timer. The claim is **near-zero
standby**, not zero.

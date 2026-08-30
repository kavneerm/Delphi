# Founder and board portraits

Drop portrait files in this folder and they appear on `/team` automatically —
no code change needed. Until a file exists, that person's card shows their
initials in a bordered frame instead.

## Filenames

Paths are set per person in `app/team/page.tsx` — the `team` array for
founders, `board` for external board members. Current expected files:

| Person          | File                    |
| --------------- | ----------------------- |
| Nahom Sisay     | `nahom-sisay.webp`      |
| Kavneer Majhail | `kavneer-majhail.webp`  |

Board members take an optional `img` field the same way.

## These are cutouts, not photographs

The founder cards are built for **background-removed portraits**: the figure
bleeds off the bottom edge of the card with no frame around it, so it reads
as someone standing in the card. That only works if the file has a real
transparent background.

- **WebP or PNG.** JPEG has no transparency — a `.jpg` renders as a grey box
  in the card and the whole effect is lost. Prefer WebP: the same portrait is
  53KB as WebP against 591KB as PNG, for a photograph with an alpha channel.
- **Crop tight to the figure.** Transparent padding inside the file is not
  free: the layout sizes the image, so padding shrinks the person and floats
  them off the card floor. Trim to the silhouette on all four sides.
- **Crop at the chest or waist, square across the bottom.** The card clips
  the bottom edge, so the figure should run *off* the bottom of the frame
  rather than ending in mid-air. A figure with visible space under it looks
  like it is hovering.
- **Head and shoulders, facing roughly forward.** The image is anchored
  bottom-right and scaled to fit, never cropped by the browser — what is in
  the file is what shows.
- **~1200px tall** is plenty. These render around 200px wide.

### Export with the alpha channel intact

This is the step that actually goes wrong. A background-removal tool shows a
checkerboard where the transparency is, but **saving or downloading can
flatten that checkerboard into white pixels**. The file then looks cut out on
a white page and renders as a pale block on `/team`.

Check before shipping:

```bash
python3 -c "from PIL import Image; im=Image.open('public/team/NAME.webp'); \
print(im.mode, im.getchannel('A').getextrema() if im.mode=='RGBA' else 'NO ALPHA')"
```

`RGBA` with a range starting at `0` is right. `RGB`, or `NO ALPHA`, means the
transparency was lost — re-export rather than trying to key it back out.

Then look at it against a **dark** background, not a white one. Cutouts made
against white keep a pale halo around fine hair that is invisible until you
do, and `/team` is the one place it shows.

### `nahom-sisay.webp` was rebuilt from a flattened file

The supplied file had no alpha channel — the checkerboard had been baked in
as near-white pixels. The matte was reconstructed here: background keyed by
colour and border-connectivity, white spill unmixed from the edge pixels, the
bowl of grapes cropped off the bottom, and the left edge (where the original
photo was cropped through the arm) feathered over 70px so it reads as
receding rather than sliced.

It holds up at display size, but the fine curl edges keep a faint silver
outline that no amount of keying recovers — that detail was destroyed when
the file was flattened. **If the original with its alpha channel still
exists, replace this file with it**: the tool's own matte will beat the
reconstruction.

## Board portraits

Board members use a small 52px frame rather than the bleed, so a tight
head-and-shoulders cutout is right there too. A square-ish crop works fine.

## Rights

Use photos you have permission to publish — subject-supplied images, official
press-kit headshots, or ones you licensed. Pulling images from search results
or social profiles is a copyright and likeness risk on a public site.

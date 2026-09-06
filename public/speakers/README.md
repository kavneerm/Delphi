# Speaker headshots

Drop headshot files in this folder and they appear on the site automatically —
no code change needed. Until a file exists, that speaker's card shows their
initials instead.

## Filenames

The path is set per speaker in the `events` array in `app/page.tsx`. Current
expected files:

| Speaker        | File                          |
| -------------- | ----------------------------- |
| Taylor Lorenz  | `taylor-lorenz.jpg`           |
| Travis Fisher  | `travis-fisher.jpg`           |
| Samuel Hammond | `samuel-hammond.jpg`          |
| Sayash Kapoor  | `sayash-kapoor.jpg`           |

To add a new speaker, add an `img: "/speakers/<file>.jpg"` field to their
entry in `app/page.tsx`.

## Image guidance

- **Square crop.** The frame is 1:1 on mobile and the image is cropped with
  `object-fit: cover`, so anything off-square gets trimmed at the edges.
- **~600×600px** is plenty. These render around 92px wide on desktop and
  under 112px on mobile, so larger files only cost load time.
- **Face centered**, since the crop takes from the middle.
- `.jpg` is assumed by the paths above. For `.png` or `.webp`, update the
  extension in `app/page.tsx` to match.

## Rights

Use photos you have permission to publish — speaker-supplied images, official
press-kit headshots, or ones you licensed. Pulling images from search results
or social profiles is a copyright and likeness risk on a public site.

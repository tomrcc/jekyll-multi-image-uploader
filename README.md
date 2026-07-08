# CloudCannon Multi-Image Uploader Demo (Jekyll + Bookshop)

A Jekyll + [Bookshop](https://github.com/cloudcannon/bookshop/) site (the Vonge
template) that demonstrates a **custom multi-image uploader** for the CloudCannon
Visual Editor.

CloudCannon's stock image input adds **one file at a time**. This repo adds a
drop-in web component that lets an editor **select or drag many images at once** —
every file is uploaded to the site's media *and* appended to a Gallery's image
grid live, with the page's front matter updated to match.

> **The demo:** open the home page in the Visual Editor. The **Gallery** block has
> a floating **"＋ Add images"** pill in its top-right corner. Select or drop
> several images and watch them upload and fill the grid in one go.

> There is a sibling repo, `astro-multi-image-uploader`, that does the same thing
> for Astro + Editable Regions. The **UX is identical but the mechanism differs**
> (see "How it works" below) — together they show how to build this on either of
> CloudCannon's two visual-editing systems.

## What this demonstrates

1. **Multi-file upload** via `uploadFile()` from the Visual Editor JS API — one
   call per selected file, returning a media URL.

2. **Writing through the API the editor is actually backed by.** This is the
   crux. Two client APIs exist in the editor:
   - `window.CloudCannonAPI.useVersion("v1")` — its `uploadFile()` works fine, but
     its `addArrayItem` did **not** change the page's front matter here.
   - `window.CloudCannon` (the legacy API the Bookshop live editor is built on) —
     the one that actually backs the front matter and live preview.

   We append with `window.CloudCannon.set(slug, newArray)` and repaint with
   `window.CloudCannon.triggerUpdateEvent()`. Using the wrong API is the classic
   trap: the upload "succeeds" but nothing appears in the grid.

3. **Resolving the data path from the live DOM.** In the editor, CloudCannon puts
   a `data-cms-bind` attribute (e.g. `#content_blocks.1`) on the component's root
   element. We read the nearest one and append the field name →
   `content_blocks.1.images`. (The static `<!--bookshop-live … -->` comments are
   rewritten by `@bookshop/live` in the live DOM, so this attribute is the
   reliable anchor.)

4. **Shadow-DOM UI that survives re-renders.** The pill renders into a shadow
   root, so the live engine's light-DOM repaint can't strip it.

## How it works

| File | Role |
| --- | --- |
| `site/js/multi-image-uploader.js` | The `<multi-image-uploader>` web component: floating pill UI, upload loop, `data-cms-bind` slug resolution, and the `CloudCannon.set` + `triggerUpdateEvent` write. Heavily commented. |
| `component-library/components/gallery/` | The Bookshop **Gallery** component (`.jekyll.html`, `.bookshop.yml`, `.scss`) with an `images` array; renders the grid and places the floating uploader. |
| `site/_layouts/default.html` | Loads the uploader script **only inside the editor** (on `cloudcannon:load` / when `CloudCannonAPI` is present), so it never ships to production. |
| `site/collections/_pages/index.html` | Home page with a `gallery` block in `content_blocks` as a live demo. |

Flow when an editor selects files:

```
select/drop files
      │
      ▼
uploadFile(file)  ──►  media URL              // 1. upload bytes (CloudCannonAPI)
      │
      ▼
CloudCannon.value()  →  append items  →  CloudCannon.set("content_blocks.N.images", newArray)
      │                                        // 2. write front matter (legacy API)
      ▼
CloudCannon.triggerUpdateEvent()              // 3. Bookshop live re-renders the grid
```

Set `localStorage.miu-debug = "1"` and reload to see verbose `[MIU]` tracing in
the console; errors always log.

## Add this to your own site

This works in any Jekyll + Bookshop site edited with CloudCannon. Steps:

1. **Copy the uploader script** `site/js/multi-image-uploader.js` into your site's
   JS folder.

2. **Load it editor-only.** In your layout, just before `</body>`, add the loader
   block from `site/_layouts/default.html` (the `<script>` that imports the
   uploader on `cloudcannon:load` / when `window.CloudCannonAPI` is present).
   Loading it only in the editor means the `<multi-image-uploader>` element is
   never defined in production, so the pill never ships.

3. **Give a component an image array + the pill.** Either copy the
   `component-library/components/gallery/` component, or add to an existing one:
   - a `<multi-image-uploader></multi-image-uploader>` element,
   - a `position: relative` wrapper around the grid so the pill anchors to the
     corner (see `gallery.scss`),
   - the `multi-image-uploader { display:none }` / `:defined { … }` CSS so the
     pill is editor-only and floats in the corner.

4. **Match your field names.** The uploader assumes an array field called
   `images` whose items are `{ image, image_alt }`. If yours differ, edit three
   spots in `multi-image-uploader.js`:
   - `resolveSlug()` — the `+ ".images"` suffix (your array field name),
   - the `uploaded.push({ image: url, image_alt: "" })` item shape,
   - the `getInputConfig({ slug: slug + ".0.image" })` field (your image field).

   You don't need to touch the data-path lookup: `resolveSlug` reads whatever
   `data-cms-bind` CloudCannon puts on the component root, so it works at any
   nesting depth (top-level component, nested array, etc.).

5. **Test in the Visual Editor, with debug logging on.** The uploader is silent
   by default, so turn on its tracing while you check the wiring:
   - Open the browser dev tools **on the site preview** (right-click inside the
     preview area → *Inspect*).
   - In that console, run `localStorage.miu-debug = "1"` and reload the editor.
   - Add a few images with the pill. You should now see `[MIU] …` log lines as it
     uploads and writes, and — the actual success check — the page's front-matter
     `images` array gains the new items **and** the grid updates on the page
     without a reload.

   The flag is only a diagnostic; the uploader works the same without it. Turn it
   off again with `localStorage.removeItem("miu-debug")`.

> **Not on Bookshop?** If your site uses CloudCannon **Editable Regions** instead
> (e.g. Astro), the data-writing mechanism is different — see the
> `astro-multi-image-uploader` sibling repo, which dispatches a bubbling
> `cloudcannon-api` event rather than calling `window.CloudCannon.set`.

---

# Vonge (base template)

Vonge is a Personal portfolio/blog site template for Jekyll. Browse through a [live demo](https://jazzed-kale.cloudvent.net/).
Increase the web presence of your brand with this configurable theme.

![Vonge template screenshot](_screenshot.png)

Vonge was made by [CloudCannon](http://cloudcannon.com/), the JAMStack Cloud CMS.
The component library is built and maintained for use with [Bookshop](https://github.com/cloudcannon/bookshop/)

Find more templates, themes and step-by-step Jekyll tutorials at [CloudCannon Community](https://cloudcannon.com/community/).

[![Deploy to CloudCannon](https://buttons.cloudcannon.com/deploy.svg)](https://app.cloudcannon.com/register#sites/connect/github/CloudCannon/vonge-jekyll-bookshop-template)

## Features

* Component library for website building
* Fully configurable Website
* Pre-built pages
* Pre-styled components
* Blog
* Category pages
* Testimonials
* Portfolio
* Live editing with [CloudCannon](http://cloudcannon.com/)
* Optimised for editing in [CloudCannon](http://cloudcannon.com/)
* Search engine optimisation

## Develop

Vonge was built with [Jekyll](http://jekyllrb.com/) version 4.2.1, but should support newer versions as well.

Install the dependencies for Bookshop:

~~~bash
$ npm install
~~~

Install the Jekyll dependencies with [Bundler](http://bundler.io/):

~~~bash
$ npm run jekyll:install
~~~

Run the website:

~~~bash
$ npm start
~~~


> [!IMPORTANT]
> When running locally, the pagination will not work. Deploy to CloudCannon to see successful pagination. 
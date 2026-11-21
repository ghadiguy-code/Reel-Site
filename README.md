# Reel Picks: your reels and product links in one dark page

Free hosting on GitHub Pages. No server, no monthly cost, no domain needed.
You get an address like `https://YOUR-USERNAME.github.io/my-reels/`.

## One-time setup (about 10 minutes)

1. **Make a GitHub account** at github.com (free), then create a new **public** repository named `my-reels`.
   Free GitHub Pages needs a public repo. The site is public anyway.
2. **Upload this folder.** From a terminal inside this folder:
   ```bash
   git init -b main
   git add -A
   git commit -m "First version"
   git remote add origin https://github.com/YOUR-USERNAME/my-reels.git
   git push -u origin main
   ```
   Check that the `.github` folder arrived. It holds the automation.
   (If you upload through the website instead, drag the whole folder in and confirm `.github/workflows` shows up.)
3. **Turn on hosting.** Repo → *Settings* → *Pages* → under *Build and deployment*, set **Source** to **GitHub Actions**.
4. **Publish the first time.** Repo → *Actions* tab → *Deploy site* → *Run workflow*.
   After about a minute your site is live at the address shown on the Pages settings screen.
5. **Make it yours.** Edit `site/data/site.json` (name, heading, tagline, Instagram link, accent colour, affiliate note).
   Put your site address in your Instagram bio.

## Adding a reel (the part you'll repeat)

1. Repo → *Issues* → *New issue* → **Add a reel**. Bookmark this page on your phone.
2. Paste the **product link**. Press *Submit new issue*.
3. About a minute later the bot replies on the issue and the card is live.

What it fills in by itself from the product link: title, description, product image, and the next number (#1, #2, #3…).
The first real reel you add removes the three sample cards.

**The reel itself.** Instagram does not let any website read your reels from a link, so there are two options:

- **Paste the reel link** in the optional *Reel link* box. This takes ten extra seconds and works for Instagram, YouTube Shorts, or a direct `.mp4`.
- **Leave it empty.** If the product page is on Shopify and has a video attached, that video is used automatically. Otherwise the card shows the product image and buy button, and you can attach the reel later by submitting the *same product link* again with the reel link filled in. It updates the existing card, it does not add a duplicate.

Use *Title* and *Description* if you want your own wording instead of the store's.
You can also use *Actions* → *Add reel* → *Run workflow*, which does the same thing.

## How it behaves

- Viewers tap a card (or **Watch reel**) to play the reel in a pop-up, then tap **Get yours here**.
- Search works on names, descriptions and numbers (`#12`). Each reel has a shareable link like `…/my-reels/#12`.
- Only **you** can add reels. Issues opened by anyone else are ignored.
- To fix or remove an entry, edit `site/data/reels.json` on GitHub (pencil icon) and save. The site redeploys.

## Fully automatic reels (optional, later)

To have new reels appear with no form at all, the site would need to read your Instagram account through Instagram's official API.
That requires a Business or Creator account connected to a Facebook Page and a Meta developer token that must be renewed about every 60 days.
It can be added on top of this setup (a scheduled workflow that picks up new reels and reads the product link from your caption).

## Troubleshooting

- *Workflow fails with a permissions error:* Settings → Actions → General → Workflow permissions → **Read and write**.
- *Site shows "Couldn't load the list":* open it through the GitHub Pages address, not by double-clicking `index.html`.
- *Product page blocked the bot* (Amazon often does): the card is still added with a title made from the link. Resubmit the same link with a Title and Description.
- *Your default branch isn't `main`:* change `branches: [main]` in `.github/workflows/deploy.yml`.

## Files

```
site/                       the website (what gets published)
  index.html style.css app.js
  data/reels.json           all your reels (the bot edits this)
  data/site.json            name, tagline, colours
scripts/add-reel.mjs        reads the product page and adds the entry
.github/workflows/          deploy.yml (publishes), add-reel.yml (the automation)
.github/ISSUE_TEMPLATE/     the "Add a reel" form
```

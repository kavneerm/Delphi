# Deploying on AWS — cost analysis and plan

**Status:** analysis only. No infrastructure exists, no Terraform written, no AWS account
touched. The prompt to start the work is at the bottom.

---

## 1. What is actually being deployed

This determines everything else, so it goes first.

`npm run build` emits `dist/`:

| file | size | gzipped |
| --- | --- | --- |
| `index.html` | ~4 kB | ~1.7 kB |
| `assets/index-*.css` | ~5 kB | ~1.9 kB |
| `assets/index-*.js` | ~237 kB | ~87 kB |

That is the whole artifact. **~90 kB gzipped per cold visit, three files, no server.**

- No backend, no API, no database, no sessions, no auth.
- All art is generated in the browser at runtime — there are no image assets to serve.
  (`Object Reference/` is client reference material in the repo; it is **not** deployed.)
- No server-side rendering. `index.html` is static and identical for every visitor.
- No routing — it is one page. No SPA fallback rule is needed.

**Anything that provisions a running compute instance is the wrong answer here**, and the
rest of this document is mostly about not being talked into one.

---

## 2. Options, cheapest first

Prices are AWS list prices for `us-east-1` and should be re-checked before committing —
they move, and they differ by region.

| Option | Monthly cost at low traffic | Verdict |
| --- | --- | --- |
| **S3 + CloudFront (OAC)** | **$0.00–0.50** | **Recommended.** |
| S3 static website hosting, no CDN | ~$0.05 | Cheaper on paper, but no HTTPS on a custom domain, no HTTP/2, worse latency. The saving is cents; the cost is real. |
| Amplify Hosting | ~$0.15/GB served + $0.01/build-min | Convenient, but bills ~1.75× CloudFront per GB for an identical result. Its value is CI and preview branches, which this does not need. |
| Lightsail (smallest instance) | ~$5 | A server, permanently running, to hand out three static files. |
| App Runner / ECS Fargate | ~$5–25 | As above, with more moving parts. |
| EC2 `t4g.nano` + nginx | ~$3 + EBS | As above, and now you patch an OS. |

### Why S3 + CloudFront comes out at roughly zero

- **S3 storage:** ~250 kB. At $0.023/GB-month this rounds to $0.000006. Free.
- **S3 requests:** CloudFront caches, so origin requests are rare. Cents at most.
- **CloudFront:** the perpetual free tier includes **1 TB egress and 10M requests per
  month**. At ~90 kB per visit, 1 TB is on the order of **ten million visits/month**. For an
  advocacy site this is free, not "cheap".
- **Beyond the free tier:** ~$0.085/GB for the first 10 TB in North America/Europe.
- **ACM certificate:** free.
- **Route 53 hosted zone:** **$0.50/month** — if you use a custom domain, this is the only
  guaranteed recurring charge on the whole stack. Without a custom domain, the CloudFront
  `*.cloudfront.net` name is free and the total is ~$0.

**Realistic expectation: $0/month without a custom domain, $0.50/month with one**, until
traffic is in the millions.

### Non-AWS, stated for honesty

Cloudflare Pages and Netlify would host this free with less setup. AWS was specified, so
this plan is AWS — but if the goal is purely lowest cost and least work, they are worth a
sentence of consideration before building anything.

---

## 3. What the Terraform must contain

Small, and worth getting exactly right:

1. **S3 bucket**, private. `block_public_acls`, `block_public_policy`,
   `ignore_public_acls`, `restrict_public_buckets` all `true`. The bucket is *never* public;
   CloudFront reaches it through OAC.
2. **CloudFront Origin Access Control** (OAC — not the deprecated OAI), plus the bucket
   policy granting `s3:GetObject` to that distribution only.
3. **CloudFront distribution**
   - `default_root_object = "index.html"`
   - Redirect HTTP → HTTPS
   - Compression on (`compress = true`) — this is what makes the 237 kB bundle 87 kB
   - `PriceClass_100` unless a global audience is wanted; it is materially cheaper
   - Managed cache policy `CachingOptimized`
4. **Cache headers, and they matter here.** Vite fingerprints `assets/*` filenames, so
   those get `max-age=31536000, immutable`, and `index.html` gets `no-cache`. Without this
   split, either the site goes stale for a year or nothing caches at all.
5. **ACM certificate + Route 53 records** — only if a custom domain is used. The
   certificate **must** be issued in `us-east-1` regardless of the distribution's region;
   this is the single most common way this stack fails first time.
6. **State backend.** Local state is fine for one person; if more than one person will ever
   run it, S3 + DynamoDB locking, and decide that before the first `apply`, not after.

Deployment is then `npm run build` → `aws s3 sync dist/ s3://<bucket> --delete` →
CloudFront invalidation of `/index.html` (invalidating `/*` is wasteful when asset names
are fingerprinted).

---

## 4. Verification — the point of the exercise

Deploying is not the same as having deployed correctly. The build already has checks that
run against a *local* server; the value of this work is running the same measurements
against the deployed artifact:

- [ ] The bucket is genuinely not public: a direct S3 URL returns 403.
- [ ] `curl -I` on the CloudFront URL shows `content-encoding: gzip` (or `br`) — if not,
      compression is off and every visitor pays 237 kB instead of 87 kB.
- [ ] `index.html` returns `cache-control: no-cache`; `assets/*` returns `immutable`.
- [ ] HTTP redirects to HTTPS.
- [ ] **`docs/plans/build.md` §7's budgets re-measured against the deployed URL**, not a
      local one — that is what those budgets were always about.
- [ ] **Safari and Firefox.** Still entirely untested. The build leans on `mix-blend-mode`,
      `isolation`, `color-mix`, `backdrop-filter` and SVG `feColorMatrix`. This is the
      largest open risk in the project and a deployed URL is the natural moment to close it.

---

## 5. Prompt to start this work

> Deploy the static site in this repo to AWS with Terraform, and verify it end to end.
>
> Read `docs/plans/deploy-aws.md` first — it has the cost analysis and the architecture
> decision already made: **S3 + CloudFront with Origin Access Control**, because the
> artifact is three static files totalling ~90 kB gzipped and anything with a running
> instance costs more for no benefit. Do not re-litigate that unless you find something in
> the repo that contradicts it; if you do, say so before building.
>
> Write the Terraform under `infra/`. It must include: a private S3 bucket with all four
> public-access blocks on; CloudFront with OAC and a bucket policy scoped to that
> distribution; `default_root_object`, HTTPS redirect, `compress = true`,
> `PriceClass_100`; and the two-tier cache headers — `immutable` for the fingerprinted
> `assets/*`, `no-cache` for `index.html`. Skip ACM and Route 53 for now and use the
> default `*.cloudfront.net` name; ask me before adding a custom domain, since the Route 53
> hosted zone is the only recurring charge in the stack.
>
> Add an `npm run deploy` script that builds, syncs `dist/` with `--delete`, and invalidates
> `/index.html` only — asset names are fingerprinted, so invalidating `/*` is waste.
>
> Then verify against the deployed URL and show me the actual command output for each:
> the S3 URL returns 403 directly; `curl -I` shows content-encoding gzip or br; `index.html`
> is `no-cache` and `assets/*` are `immutable`; HTTP redirects to HTTPS; and the site
> renders and scrolls correctly. Do not report success without the output.
>
> Constraints: run `terraform plan` and show it to me before any `apply`. Do not create IAM
> users or long-lived access keys. Do not commit any `.tfstate`, `.tfvars` or credentials —
> add them to `.gitignore` first. Tell me the expected monthly cost when you are done, and
> flag anything you had to guess at.

---

## 6. Two things to decide before starting

1. **Custom domain or not.** Without one: $0/month, ugly URL. With one: $0.50/month plus
   whatever the domain costs, and the ACM certificate must be issued in `us-east-1`.
2. **Who else runs this.** If the answer is "only me", local Terraform state is fine and
   simpler. If anyone else might, set up the S3 + DynamoDB backend before the first apply —
   migrating state afterwards is avoidable work.

/* Static export for S3 + CloudFront.

   trailingSlash matters: without it Next emits team.html, but the CloudFront
   viewer-request function rewrites an extensionless /team to /team/index.html.
   With it, the export writes team/index.html and the existing edge function
   works unchanged. */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};
export default nextConfig;

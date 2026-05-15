import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/**
 * GitHub Pages serves this site at https://codingbutter.github.io/cardboard/.
 * Next.js needs basePath + assetPrefix so internal links and assets resolve
 * under that subpath, trailingSlash so directory-style URLs work, and
 * images.unoptimized because the default image optimizer doesn't run in
 * a static export.
 *
 * @type {import('next').NextConfig}
 */
const config = {
  output: 'export',
  basePath: '/cardboard',
  assetPrefix: '/cardboard',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default withMDX(config);

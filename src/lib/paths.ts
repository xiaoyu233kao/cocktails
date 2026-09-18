/** Prefix a site asset or route with Astro's configured Pages base path. */
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  return `${base.replace(/\/$/, '/')}${cleanPath}`;
}

export function cocktailPath(slug: string): string {
  return withBase(`recipes/${slug}/`);
}

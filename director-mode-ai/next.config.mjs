/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async redirects() {
    /*
     * CourtConnect is one product now: the per-club partner finder. The May
     * prototype's shared games pages are retired and land on /courtconnect,
     * which sends each person to the right board. PlayerVault
     * (/courtconnect/vault) and /courtconnect/club are NOT in this list.
     * Temporary (307) on purpose, so the paths stay free to reuse.
     */
    const retired = ['home', 'events', 'players', 'notifications', 'dashboard', 'profile'];
    return [
      ...retired.flatMap((p) => [
        { source: `/courtconnect/${p}`, destination: '/courtconnect', permanent: false },
        { source: `/courtconnect/${p}/:path*`, destination: '/courtconnect', permanent: false },
      ]),
      // The director view was built as "Partner Finder".
      { source: '/run/members/partner-finder', destination: '/run/members/courtconnect', permanent: false },
    ];
  },
};

export default nextConfig;

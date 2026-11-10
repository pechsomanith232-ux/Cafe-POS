import type { MetadataRoute } from "next";

// Makes the app installable on the shop tablet (plan Phase 9). Selling still needs a connection.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Café POS",
    short_name: "Café POS",
    description: "Point of sale and inventory for cafés",
    start_url: "/pos",
    display: "standalone",
    orientation: "landscape",
    background_color: "#ffffff",
    theme_color: "#7c2d12",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  const rawBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const basePath = rawBasePath && rawBasePath !== "/"
    ? `/${rawBasePath.replace(/^\/+|\/+$/g, "")}`
    : "";

  return {
    name: "날씨길 | Weather Route",
    short_name: "날씨길",
    description: "집과 회사의 날씨와 이동하기 좋은 시간을 알려주는 개인 날씨 경로 도우미",
    id: `${basePath}/`,
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#eef5fb",
    theme_color: "#10263f",
    lang: "ko-KR",
    icons: [
      { src: `${basePath}/icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}

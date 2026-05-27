import { notFound } from "next/navigation";
import { getProductByHandle, formatMoney } from "@/lib/shopify";
import { ProductDetailClient } from "./_components/ProductDetailClient";

// /shop/[handle] — single-product detail.
//
// Server component: fetches the product by handle (URL slug). Hands
// the data to a client component (ProductDetailClient) so the
// variant picker, quantity stepper, and add-to-cart can manage their
// own state. metadata is generated per-product for SEO + social.

type Props = { params: { handle: string } };

export async function generateMetadata({ params }: Props) {
  try {
    const product = await getProductByHandle(params.handle);
    if (!product) return { title: "Not found | House Party Distro" };
    return {
      title: `${product.title} | House Party Distro`,
      description: product.description?.slice(0, 160) || undefined,
      openGraph: {
        title: product.title,
        description: product.description?.slice(0, 160),
        images: product.featuredImage ? [product.featuredImage.url] : undefined,
      },
    };
  } catch {
    return { title: "Shop | House Party Distro" };
  }
}

export default async function ProductPage({ params }: Props) {
  const product = await getProductByHandle(params.handle);
  if (!product) notFound();

  return (
    <section style={{
      background: "#0a0a0c",
      color: "#fff",
      paddingTop: 96,
      minHeight: "100vh",
    }}>
      <ProductDetailClient product={product} />
    </section>
  );
}

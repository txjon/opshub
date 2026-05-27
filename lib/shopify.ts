// Headless Shopify storefront client.
//
// Hits Shopify's public Storefront GraphQL API with a public access
// token. Token is read-only (products, collections, inventory) plus
// cart writes — it cannot touch the admin or order data, so it's safe
// to expose to the client.
//
// Env vars expected:
//   NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN     e.g. housepartydistro.myshopify.com
//   NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN public Storefront API token
//   SHOPIFY_API_VERSION                  optional, defaults below

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2024-10";

function endpoint() {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN not set");
  return `https://${domain}/api/${API_VERSION}/graphql.json`;
}

function token() {
  const t = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!t) throw new Error("NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN not set");
  return t;
}

export async function shopifyFetch<T>(
  query: string,
  variables?: Record<string, any>,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token(),
    },
    body: JSON.stringify({ query, variables }),
    // Default to ISR-style caching; routes that need fresh data
    // (cart mutations) override with `cache: 'no-store'` per call.
    next: { revalidate: 60 },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  }
  const body = await res.json();
  if (body.errors) {
    throw new Error(`Shopify GraphQL: ${JSON.stringify(body.errors)}`);
  }
  return body.data as T;
}

// ── Types ─────────────────────────────────────────────────────────────

export type Money = { amount: string; currencyCode: string };

export type ProductImage = {
  url: string;
  altText: string | null;
  width: number;
  height: number;
};

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  price: Money;
  compareAtPrice: Money | null;
  selectedOptions: { name: string; value: string }[];
};

export type Product = {
  id: string;
  handle: string;
  title: string;
  description: string;
  descriptionHtml: string;
  vendor: string;
  productType: string;
  tags: string[];
  availableForSale: boolean;
  priceRange: { minVariantPrice: Money; maxVariantPrice: Money };
  featuredImage: ProductImage | null;
  images: ProductImage[];
  options: { id: string; name: string; values: string[] }[];
  variants: ProductVariant[];
};

export type Collection = {
  id: string;
  handle: string;
  title: string;
  description: string;
  image: ProductImage | null;
  products: Product[];
};

// ── Queries ───────────────────────────────────────────────────────────

const PRODUCT_FIELDS = `
  id
  handle
  title
  description
  descriptionHtml
  vendor
  productType
  tags
  availableForSale
  priceRange {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  featuredImage { url altText width height }
  images(first: 12) {
    edges { node { url altText width height } }
  }
  options { id name values }
  variants(first: 50) {
    edges {
      node {
        id
        title
        availableForSale
        price { amount currencyCode }
        compareAtPrice { amount currencyCode }
        selectedOptions { name value }
      }
    }
  }
`;

function normalizeProduct(raw: any): Product {
  return {
    ...raw,
    images: raw.images.edges.map((e: any) => e.node),
    variants: raw.variants.edges.map((e: any) => e.node),
  };
}

export async function getAllProducts(first: number = 50): Promise<Product[]> {
  const data = await shopifyFetch<{ products: { edges: { node: any }[] } }>(
    `query AllProducts($first: Int!) {
      products(first: $first, sortKey: UPDATED_AT, reverse: true) {
        edges { node { ${PRODUCT_FIELDS} } }
      }
    }`,
    { first }
  );
  return data.products.edges.map(e => normalizeProduct(e.node));
}

export async function getProductByHandle(handle: string): Promise<Product | null> {
  const data = await shopifyFetch<{ product: any | null }>(
    `query ProductByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_FIELDS} }
    }`,
    { handle }
  );
  return data.product ? normalizeProduct(data.product) : null;
}

export async function getCollectionByHandle(handle: string, productCount: number = 50): Promise<Collection | null> {
  const data = await shopifyFetch<{ collection: any | null }>(
    `query CollectionByHandle($handle: String!, $productCount: Int!) {
      collection(handle: $handle) {
        id
        handle
        title
        description
        image { url altText width height }
        products(first: $productCount) {
          edges { node { ${PRODUCT_FIELDS} } }
        }
      }
    }`,
    { handle, productCount }
  );
  if (!data.collection) return null;
  return {
    ...data.collection,
    products: data.collection.products.edges.map((e: any) => normalizeProduct(e.node)),
  };
}

// ── Cart mutations ────────────────────────────────────────────────────
// The Storefront Cart API supersedes the older Checkout API. A cart's
// `checkoutUrl` is the redirect the user hits when they tap Checkout.

export type CartLine = {
  id: string;
  quantity: number;
  merchandise: {
    id: string;
    title: string;
    product: { title: string; handle: string; featuredImage: ProductImage | null };
    price: Money;
    selectedOptions: { name: string; value: string }[];
  };
};

export type Cart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: { subtotalAmount: Money; totalAmount: Money };
  lines: CartLine[];
};

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
  }
  lines(first: 100) {
    edges {
      node {
        id
        quantity
        merchandise {
          ... on ProductVariant {
            id
            title
            price { amount currencyCode }
            selectedOptions { name value }
            product {
              title
              handle
              featuredImage { url altText width height }
            }
          }
        }
      }
    }
  }
`;

function normalizeCart(raw: any): Cart {
  return {
    ...raw,
    lines: raw.lines.edges.map((e: any) => e.node),
  };
}

export async function createCart(): Promise<Cart> {
  const data = await shopifyFetch<{ cartCreate: { cart: any } }>(
    `mutation { cartCreate { cart { ${CART_FIELDS} } } }`,
    {},
    { cache: "no-store" }
  );
  return normalizeCart(data.cartCreate.cart);
}

export async function getCart(cartId: string): Promise<Cart | null> {
  const data = await shopifyFetch<{ cart: any | null }>(
    `query Cart($cartId: ID!) {
      cart(id: $cartId) { ${CART_FIELDS} }
    }`,
    { cartId },
    { cache: "no-store" }
  );
  return data.cart ? normalizeCart(data.cart) : null;
}

export async function addToCart(cartId: string, lines: { merchandiseId: string; quantity: number }[]): Promise<Cart> {
  const data = await shopifyFetch<{ cartLinesAdd: { cart: any } }>(
    `mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } }
    }`,
    { cartId, lines },
    { cache: "no-store" }
  );
  return normalizeCart(data.cartLinesAdd.cart);
}

export async function updateCartLines(cartId: string, lines: { id: string; quantity: number }[]): Promise<Cart> {
  const data = await shopifyFetch<{ cartLinesUpdate: { cart: any } }>(
    `mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ${CART_FIELDS} } }
    }`,
    { cartId, lines },
    { cache: "no-store" }
  );
  return normalizeCart(data.cartLinesUpdate.cart);
}

export async function removeFromCart(cartId: string, lineIds: string[]): Promise<Cart> {
  const data = await shopifyFetch<{ cartLinesRemove: { cart: any } }>(
    `mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ${CART_FIELDS} } }
    }`,
    { cartId, lineIds },
    { cache: "no-store" }
  );
  return normalizeCart(data.cartLinesRemove.cart);
}

export function formatMoney(money: Money): string {
  const num = parseFloat(money.amount);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: money.currencyCode,
  }).format(num);
}

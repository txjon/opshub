"use client";
import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";
import {
  Cart,
  addToCart as apiAddToCart,
  createCart,
  getCart,
  removeFromCart as apiRemoveFromCart,
  updateCartLines as apiUpdateCartLines,
} from "@/lib/shopify";

// Cart context for the headless shop.
//
// Persists a Shopify cart id in localStorage so the user's bag survives
// refreshes and revisits. On first add, lazily creates a cart via the
// Storefront API. All mutations (add / update qty / remove) flow through
// Shopify so totals + inventory + discounts stay accurate.
//
// The drawer reads `cart` + `isOpen`; mutations are awaited so the
// drawer can show loading states per row if needed later.

const STORAGE_KEY = "hpd_cart_id";

type CartContextValue = {
  cart: Cart | null;
  isOpen: boolean;
  loading: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  addItem: (merchandiseId: string, quantity: number) => Promise<void>;
  updateLine: (lineId: string, quantity: number) => Promise<void>;
  removeLine: (lineId: string) => Promise<void>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // On mount, try to rehydrate the cart from localStorage.
  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (!id) return;
    (async () => {
      try {
        const existing = await getCart(id);
        if (existing) setCart(existing);
        else {
          // Cart was completed or expired — clear and let next add create
          // a fresh one.
          localStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    })();
  }, []);

  // Helper to ensure we have a cart, creating one if needed.
  async function ensureCart(): Promise<Cart> {
    if (cart) return cart;
    const created = await createCart();
    localStorage.setItem(STORAGE_KEY, created.id);
    setCart(created);
    return created;
  }

  const addItem = useCallback(async (merchandiseId: string, quantity: number) => {
    setLoading(true);
    try {
      const c = await ensureCart();
      const updated = await apiAddToCart(c.id, [{ merchandiseId, quantity }]);
      setCart(updated);
      setIsOpen(true);  // pop the drawer so the user sees confirmation
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  const updateLine = useCallback(async (lineId: string, quantity: number) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updated = await apiUpdateCartLines(cart.id, [{ id: lineId, quantity }]);
      setCart(updated);
    } finally {
      setLoading(false);
    }
  }, [cart]);

  const removeLine = useCallback(async (lineId: string) => {
    if (!cart) return;
    setLoading(true);
    try {
      const updated = await apiRemoveFromCart(cart.id, [lineId]);
      setCart(updated);
    } finally {
      setLoading(false);
    }
  }, [cart]);

  return (
    <CartContext.Provider value={{
      cart,
      isOpen,
      loading,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen(o => !o),
      addItem,
      updateLine,
      removeLine,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}

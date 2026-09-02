// cart.js — jorarebooks.com shopping cart
//
// Client-side only. The cart stores a display snapshot of each item
// (title, author, price, thumb, url) purely so the drawer has something
// to show — it is NOT the source of truth for price or availability.
// At checkout, the server re-fetches every item fresh from Airtable and
// rejects/updates anything that's changed or gone. Never trust this
// data for money math beyond the running subtotal shown in the drawer.

const CART_KEY = 'jor_cart';

function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  updateCartUI();
}

function addToCart(item) {
  const cart = getCart();
  if (cart.some(i => i.id === item.id)) {
    openCart();
    return;
  }
  cart.push(item);
  saveCart(cart);
  openCart();
}

function removeFromCart(id) {
  saveCart(getCart().filter(i => i.id !== id));
}

function parsePrice(priceStr) {
  const n = parseFloat((priceStr || '').replace(/[^0-9.]/g, ''));
  return isNaN(n) ? 0 : n;
}

function formatUsd(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function updateCartUI() {
  const cart = getCart();
  const countEl = document.getElementById('nav-cart-count');
  if (countEl) {
    countEl.textContent = cart.length;
    countEl.style.display = cart.length ? '' : 'none';
  }
  renderCartDrawer();
}

function renderCartDrawer() {
  const itemsEl = document.getElementById('cart-items');
  const summaryEl = document.getElementById('cart-summary');
  if (!itemsEl || !summaryEl) return;

  const cart = getCart();

  if (!cart.length) {
    itemsEl.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    summaryEl.innerHTML = '';
    return;
  }

  itemsEl.innerHTML = cart.map(item => `
    <div class="cart-item">
      <a href="${item.url}" class="cart-item-thumb-link">
        ${item.thumb ? `<img class="cart-item-thumb" src="${item.thumb}" alt="">` : '<div class="cart-item-thumb cart-item-thumb-empty"></div>'}
      </a>
      <div class="cart-item-body">
        <a href="${item.url}" class="cart-item-title">${item.title}</a>
        ${item.author ? `<div class="cart-item-meta">${item.author}</div>` : ''}
        <div class="cart-item-row">
          <button type="button" class="cart-item-remove" onclick="removeFromCart('${item.id}')">Remove</button>
          <span class="cart-item-price">${item.price}</span>
        </div>
      </div>
    </div>
  `).join('');

  const subtotal = cart.reduce((sum, item) => sum + parsePrice(item.price), 0);
  const shippingNote = subtotal >= 250
    ? 'Free shipping — orders over $250'
    : `+ $10 shipping (free over $250)`;

  summaryEl.innerHTML = `
    <div class="cart-summary-row">
      <span>Subtotal</span>
      <span>${formatUsd(subtotal)}</span>
    </div>
    <div class="cart-shipping-note">${shippingNote}</div>
    <div class="cart-tax-note">Sales tax added for New Jersey addresses. Final total shown at checkout.</div>
    <div id="cart-checkout-error" class="cart-checkout-error" style="display:none;"></div>
    <button type="button" class="cart-checkout-btn" onclick="startCheckout()">Checkout</button>
    <span class="cart-continue" onclick="closeCart()">Continue browsing</span>
  `;
}

function openCart() {
  const overlay = document.getElementById('cart-overlay');
  if (!overlay) return;
  updateCartUI();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCart() {
  const overlay = document.getElementById('cart-overlay');
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

async function startCheckout() {
  const cart = getCart();
  if (!cart.length) return;

  const errorEl = document.getElementById('cart-checkout-error');
  const btn = document.querySelector('.cart-checkout-btn');
  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  if (btn) { btn.disabled = true; btn.textContent = 'Starting checkout...'; }

  try {
    const response = await fetch('/.netlify/functions/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: cart.map(item => item.id) })
    });
    const data = await response.json();

    if (!response.ok) {
      // Prune anything the server says is gone or already sold, so the
      // drawer reflects reality instead of re-offering a dead item.
      if (Array.isArray(data.unavailable) && data.unavailable.length) {
        const staleIds = data.unavailable.map(u => u.id);
        saveCart(getCart().filter(item => !staleIds.includes(item.id)));
      }
      if (errorEl) {
        errorEl.style.display = '';
        errorEl.textContent = data.error || 'Something went wrong. Please try again.';
      }
      return;
    }

    window.location.href = data.url;
  } catch (e) {
    if (errorEl) {
      errorEl.style.display = '';
      errorEl.textContent = 'Could not reach checkout. Check your connection and try again.';
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Checkout'; }
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCart();
});

document.addEventListener('DOMContentLoaded', updateCartUI);

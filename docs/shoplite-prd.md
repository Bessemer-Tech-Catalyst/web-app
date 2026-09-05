# ShopLite — Product Requirements

**Version 1.3 · Owner: Commerce · Status: in build**

ShopLite is a single-account demonstration storefront: four products, a basket, a
checkout, and a history of what the account has bought. It exists to be small enough to
read in one sitting and complete enough to have real failure modes.

## 1. Accounts and access

**1.1 Sign in.** A shopper signs in with an email address and a password. On success the
application places the shopper on the product catalogue.

**1.2 Rejected credentials.** A sign-in attempt with a wrong password must be refused,
must keep the shopper on the sign-in page, and must show an error message. The message
must not say which of the two fields was wrong.

**1.3 Session scope.** Signing in establishes a session carried by a cookie. Every page
other than sign-in is behind that session.

**1.4 Signed-out redirect.** A shopper who reaches a protected page without a session is
returned to sign in rather than shown an empty page or an error.

**1.5 Password reset.** A shopper who has forgotten their password can request a reset
link by email from the sign-in page. The link expires after 30 minutes and may be used
once. *(Not yet built — targeted for 1.4.)*

## 2. Catalogue and basket

**2.1 Catalogue.** The catalogue lists every product in stock with its name, a one-line
description, and its price in pounds.

**2.2 Add to basket.** Each product can be added to the basket from the catalogue in one
action, and the control reports back that the item was added.

**2.3 Basket contents.** The basket lists each line with its quantity and line price, and
shows a total that is the sum of the lines.

**2.4 Quantity change.** A shopper can change the quantity of a line in the basket, and
the total must follow immediately.

**2.5 Empty basket.** An empty basket says so, and offers no way to place an order.

**2.6 Basket lifetime.** The basket is held for the browser session only. It is not
carried between browsers and is not stored against the account.

## 3. Checkout and orders

**3.1 Place an order.** A shopper with a non-empty basket can place an order in one
action from the basket page.

**3.2 Confirmation.** After an order is placed, the shopper is shown a confirmation
carrying the order's identifier.

**3.3 Basket cleared.** Placing an order empties the basket.

**3.4 Order history.** The orders page lists every order the account has placed, most
recent first, each with its identifier, its date, its lines, and its total.

**3.5 Order history failure.** If order history cannot be loaded, the page must say so
explicitly rather than render as though the account has never ordered.

**3.6 Refunds.** A shopper can request a refund against a delivered order within 14 days,
and see the request's status in order history. *(Not yet built — targeted for 1.5.)*

## 4. Non-functional

**4.1 Prices.** Prices are held and computed in whole pence. No total is ever produced by
floating-point arithmetic over pounds.

**4.2 Error visibility.** Any failure the shopper causes or suffers is shown in the page,
not only in the console.

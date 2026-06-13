# `POST /orders` — End-to-End Flow

This document traces a single order from the moment a customer submits it to the moment it's
confirmed, plus the background tasks that tidy up afterwards. Diagrams are
[Mermaid](https://mermaid.js.org/) and render natively on GitHub.

---

## 1. Placing an order (what happens during the request)

```mermaid
flowchart TD
    Client(["Customer submits an order"]) --> RL

    %% ───────────────────────── Front door ─────────────────────────
    subgraph route["Front door"]
        RL{"Too many requests<br/>from this customer?"}
        VAL{"Is the request<br/>filled in correctly?"}
    end
    RL -->|"yes"| R429(["Ask them to slow down — 429"])
    RL -->|"no"| VAL
    VAL -->|"no"| R400(["Reject as malformed — 400"])
    VAL -->|"yes"| CLAIM

    %% ─────────────────── Have we seen this before? ──────────────────
    subgraph ctrl["Duplicate check"]
        CLAIM{"First time seeing<br/>this order?"}
        DUP{"Did we already<br/>finish it earlier?"}
    end
    CLAIM -->|"no — sent more than once"| DUP
    DUP -->|"yes"| RCACHED(["Send back the original result<br/>(don't charge again)"])
    DUP -->|"no — still working on it"| R409D(["Tell them it's already in progress — 409"])
    CLAIM -->|"yes"| ITEMS

    %% ───────────────────── Get the order ready ──────────────────────
    subgraph pre["Get the order ready"]
        ITEMS["Look up the products<br/>they want to buy"]
        ITEMS --> ITEMSOK{"Do all the<br/>products exist?"}
        ITEMSOK -->|"no"| EITEMS["Something's wrong — 500"]
        ITEMSOK -->|"yes"| WH

        WH["Find the shipping<br/>address on the map"]
        WH --> AVAIL["Check how much of each item<br/>is free to sell right now"]
        AVAIL --> WHOK{"Can a nearby warehouse<br/>cover the whole order?"}
        WHOK -->|"no"| ENOWH["No warehouse can fill it — 409"]
        WHOK -->|"yes — pick the closest"| RES

        RES["Set the items aside so no one<br/>else can take them — one product<br/>at a time, so two orders can't<br/>grab the last unit"]
        RES --> RESOK{"Still enough<br/>in stock?"}
        RESOK -->|"no"| EINV["Not enough stock — 409"]
        RESOK -->|"yes"| TAX
    end

    %% ─────────────────── Price it and take payment ──────────────────
    subgraph try["Price it and take payment"]
        TAX["Work out the tax"]
        TAX --> TAXOK{"Could we<br/>work out the tax?"}
        TAXOK -->|"no"| ETAX["Can't price it — 422"]
        TAXOK -->|"yes"| PERSIST

        PERSIST["Save the order<br/>(waiting on payment)"]
        PERSIST --> CHARGE["Charge the card"]
        CHARGE --> GETST["Check the charge<br/>actually went through"]
        GETST --> PAYRES{"Did the<br/>payment work?"}
        PAYRES -->|"declined"| EPAY["Card declined — 402"]
        PAYRES -->|"yes"| CONFIRM["Keep the items reserved<br/>and confirm the order"]
        PAYRES -->|"couldn't tell"| PENDING["Leave the order waiting<br/>(we'll check again later)"]
    end

    %% a needed service being down short-circuits to a 503
    WH -. "service down" .-> ECB["Service temporarily<br/>unavailable — 503"]
    TAX -. "service down" .-> ECB
    CHARGE -. "service down" .-> ECB

    %% ───────────────────────── Success ─────────────────────────
    CONFIRM --> DONE
    PENDING --> DONE
    DONE["Remember the result<br/>in case they ask again"] --> R201(["Order placed — 201"])

    %% ───────────────────────── Problems ─────────────────────────
    ETAX --> COMP
    EPAY --> COMP
    ECB --> COMP
    COMP["Give the reserved items back<br/>and mark the order failed"]
    COMP --> RELOK{"Did giving the<br/>items back work?"}
    RELOK -->|"no"| DLQ["Flag it for someone<br/>to look into by hand"]
    RELOK -->|"yes"| RETRY
    DLQ --> RETRY

    EITEMS --> RETRY
    ENOWH --> RETRY
    EINV --> RETRY
    RETRY["Forget this attempt so<br/>they can try again"] --> RERR(["Send back the matching error"])
```

### A few things worth knowing

- **Set items aside early.** Stock is reserved *before* tax and payment, so we fail fast if it's
  not available and never leave a half-finished order holding stock it can't pay for.
- **One order at a time per product.** When lots of orders race for the same item, they take turns
  instead of all grabbing the last unit — this is what stops us from selling more than we have.
- **"Couldn't tell" is not a failure.** If we can't confirm the charge right away, we leave the
  order *waiting* (and still tell the customer it's placed). A background task checks again later,
  so we never wrongly fail a charge that may have actually succeeded.
- **Sent twice? Charged once.** The very first attempt for an order is the only one that does the
  work; a repeat gets the original answer back, and a failed attempt can be safely retried.

### What each result code means

| Result | Cause |
|---|---|
| `201` Order placed | Confirmed, or accepted and waiting on payment |
| `201`/`200` (repeat) | Same order sent twice — original answer replayed |
| `400` Bad request | The request wasn't filled in correctly |
| `402` Payment needed | The card was declined |
| `409` Conflict | No warehouse can fill it, not enough stock, or the order is already in progress |
| `422` Can't process | We couldn't work out the tax |
| `429` Too many requests | The customer is sending requests too fast |
| `503` Unavailable | A service we depend on (payment, tax, or address lookup) is temporarily down |
| `500` Error | Something unexpected went wrong |

---

## 2. Background tidy-up (what finishes the job afterwards)

These run on a schedule and clean up anything the live request left open: items held but never
paid for, orders stuck waiting on payment, and stock that needs updating after a sale completes.

```mermaid
flowchart TD
    subgraph expire["Free up abandoned holds — every minute"]
        EX1["Release items that were set aside<br/>but never paid for"]
        EX1 --> EX2["Mark those orders as failed"]
    end

    subgraph reconcile["Sort out orders stuck on payment — every 5 minutes"]
        RC1["Find orders still waiting on<br/>payment after a few minutes"]
        RC1 --> RC2["Ask the payment provider<br/>if the charge went through"]
        RC2 --> RC3{"What's the<br/>answer?"}
        RC3 -->|"it went through"| RC4["Confirm the order"]
        RC3 -->|"it failed"| RC5["Give the items back<br/>and fail the order"]
        RC3 -->|"still not sure"| RC6["Leave it — check again next time"]
    end

    subgraph fulfill["Update stock for completed sales — every 5 minutes"]
        FF1["Add up everything that's<br/>been sold and confirmed"]
        FF1 --> FF2["Lower the warehouse stock<br/>by that amount"]
        FF2 --> FF3["Those sales no longer count<br/>against what's left to sell"]
    end
```

- **Free up abandoned holds** — items set aside for an order that never got paid go back on the
  shelf, and the order is marked failed.
- **Sort out stuck orders** — the safety net for the "couldn't tell" case above: ask the payment
  provider again and either confirm or unwind the order.
- **Update stock for completed sales** — once a sale is confirmed, the warehouse count is brought
  down to match, so finished sales stop counting against what's available to buy.

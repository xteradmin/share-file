# Pairing Module

Owns the LAN user list and click-to-connect actions.

## Entry Points

- `PairingCard.jsx` renders the local device name, available users, and connect/disconnect controls.

## Data Contract

The parent app passes the local peer, visible peers, active peer, and callbacks that emit WebSocket events. This module does not talk to the signaling socket directly.

## AI Context

Keep this module focused on user intent and peer display. Discovery, pairing, and connection state belong here; file-transfer logic should stay in the transfer module.

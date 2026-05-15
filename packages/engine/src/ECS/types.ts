/**
 * Entity ids are just numbers — the whole ECS pivots on this. Anywhere you'd
 * pass "the player object", you pass its `Entity` id instead, and look up
 * what it has from the component stores.
 */
export type Entity = number;

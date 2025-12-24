// src/lib/trelloAPI.ts

// These types are for the data we expect back from our Cloud Functions,
// which in turn get the data from the Trello API.

export interface TrelloBoard {
  id: string;
  name: string;
  url: string;
}

export interface TrelloList {
  id: string;
  name: string;
}

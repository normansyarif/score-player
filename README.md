# ScorePlayer

MusicXML score player and piano practice app.

## Setup

### Run the web app with Docker

Copy `.env.example` to `.env` and set `MYSQL_PASSWORD` (and the other MySQL settings if needed).

```sh
docker compose up --build -d
```

Open http://localhost:8081. Set `SCOREPLAYER_PORT` to use another host port.
Stop it with `docker compose down`.

MusicXML uploads are stored in `data/uploads` on the Docker host; folders and score
metadata are stored in MySQL. Back up both to preserve the library. The web library
is shared by everyone who can access this installation.

### iOS development

```sh
npm i -g @ionic/cli
ionic capacitor copy ios && ionic capacitor update
ionic capacitor run ios -l --external
```


- To make Piano sounds work on iOS:

Remove `mp3` out of `isMediaExtension` in `node_modules/@capacitor/ios/Capacitor/Capacitor/WebViewAssetHandler.swift`

```swift
    func isMediaExtension(pathExtension: String) -> Bool {
        let mediaExtensions = ["m4v", "mov", "mp4",
                               "aac", "ac3", "aiff", "au", "flac", "m4a", "wav"]
        if mediaExtensions.contains(pathExtension.lowercased()) {
            return true
        }
        return false
    }
```

## How play modes work

There are 2 cursors: 0 for Play (auto or manual) and 1 for Tempo.

The Play cursor calculates required notes in the current cursor, then listen for pressed notes and keep track of
which notes are pressed. If they are all pressed correctly, advance forward.

The Tempo cursor calculates timeout based on the notes' timestamp of the current cursor, then set the timeout to loop.
In Listen mode, it will trigger playing the required notes which are calculated by Play cursor to make the Play cursor
advance.

All logic above happens at the same time with virtual keyboard update, built-in sound play or MIDI device signal.

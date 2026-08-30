# Example graph

The `Example` folder holds a deliberately awkward little graph. It is small enough to hold in your head and still contains both of the shapes that break a naive exporter.

- [A](<./Example/A.md>) embeds `A1.png` and `A2.png`, and links `B`.
- [B](<./Example/B.md>) embeds `B3.png` and `B4.png`, links `C`, and links **back to `A`** — a cycle.
- [C](<./Example/C.md>) embeds `A1.png`, which `A` already embeds — a diamond.

## Try it

Right-click `Example/A.md` and choose **Export with dependencies**. The tree opens like this — `A`'s attachments checked, its linked note not:

```text
[x] A.md
  [x] A1.png
  [x] A2.png

  [ ] B.md
```

Tick `B.md`. It expands, and the same rule applies one level down:

```text
[x] A.md
  [x] A1.png
  [x] A2.png
  [x] B.md
    [x] B3.png
    [x] B4.png
    [ ] C.md
    [x] A.md   <- greyed out: already included above
```

That last row is the cycle. `A` is already in the export, so its second appearance is a disabled reference rather than a fresh subtree — which is why ticking `B` does not send the tree into an infinite loop.

Now tick `C.md` too, and the diamond shows up the same way:

```text
    [x] C.md
      [x] A1.png   <- greyed out: already included under A
```

`A1.png` is exported once, no matter how many notes embed it.

## Try a folder root

Right-click the `Example` folder instead. Now `A`, `B` and `C` are all roots, side by side at the top of the tree — and because each one is already a root, none of them re-expands as a dependency of the others. Their attachments still arrive checked.

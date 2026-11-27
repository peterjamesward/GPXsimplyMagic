# TODO

- [ ] Investigate whether suitable LIDAR data is available for terrain rendering.
- [ ] Display elevation differences between the GPX route, map elevation, and LIDAR data.
- [ ] Replace the box-shaped road; the road no longer needs to be a box.
- [ ] Processing pipeline options: (? new lhs panel)
  - [ ] Remove anomalous points
  - [ ] Conform to road
  - [ ] Apply minimum turn radius
  - [ ] Use original, map or LIDAR altitude (with interpolation)
  - [ ] Apply gradient smoothing.

# Questions

- Is terrain loading eager or lazy?
- Can loops be replaced with more functional forms?
- Can we profile and optimise?
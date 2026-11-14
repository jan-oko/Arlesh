package com.atai.arlesh

import android.graphics.Rect

/**
 * What a display cutout covers along one side of the window, in px: the span it covers along that
 * side (`start` to `end`, from the top for the left and right sides, from the left for the top and
 * bottom) and how far it reaches in (`depth`). Zero depth means nothing covers that side.
 */
data class CutoutBand(val start: Int, val end: Int, val depth: Int)

/** The four sides' [CutoutBand]s. */
data class CutoutBands(val left: CutoutBand, val top: CutoutBand, val right: CutoutBand, val bottom: CutoutBand)

/** A window with no cutout. */
val NO_CUTOUT = CutoutBands(CutoutBand(0, 0, 0), CutoutBand(0, 0, 0), CutoutBand(0, 0, 0), CutoutBand(0, 0, 0))

/**
 * Sorts the cutout's bounding rects (window coordinates, from `DisplayCutout.getBoundingRects()`)
 * into the side each one is cut from: the nearest edge it touches, by how far it reaches in, so a
 * camera in a landscape's short side is the left or right band and one in a corner is a band of
 * the side it sticks into least. Several rects on one side are merged into one band.
 */
fun cutoutBands(rects: List<Rect>, width: Int, height: Int): CutoutBands {
  var left = CutoutBand(0, 0, 0)
  var top = CutoutBand(0, 0, 0)
  var right = CutoutBand(0, 0, 0)
  var bottom = CutoutBand(0, 0, 0)
  for (rect in rects) {
    val reach = mutableMapOf<String, Int>()
    if (rect.left <= 0) reach["left"] = rect.right
    if (rect.right >= width) reach["right"] = width - rect.left
    if (rect.top <= 0) reach["top"] = rect.bottom
    if (rect.bottom >= height) reach["bottom"] = height - rect.top
    val side = reach.minByOrNull { it.value }?.key ?: continue
    when (side) {
      "left" -> left = left.merge(rect.top, rect.bottom, rect.right)
      "right" -> right = right.merge(rect.top, rect.bottom, width - rect.left)
      "top" -> top = top.merge(rect.left, rect.right, rect.bottom)
      else -> bottom = bottom.merge(rect.left, rect.right, height - rect.top)
    }
  }
  return CutoutBands(left, top, right, bottom)
}

/** This band widened to also cover `start`..`end` and to reach in as far as `depth`. */
private fun CutoutBand.merge(start: Int, end: Int, depth: Int): CutoutBand =
  if (this.depth == 0) CutoutBand(start, end, depth)
  else CutoutBand(minOf(this.start, start), maxOf(this.end, end), maxOf(this.depth, depth))

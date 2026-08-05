from __future__ import annotations

from dataclasses import dataclass
from math import cos, floor, log, pi, sin, tan


@dataclass(frozen=True)
class GridCoordinate:
    nx: int
    ny: int


def latitude_longitude_to_grid(latitude: float, longitude: float) -> GridCoordinate:
    """Convert WGS84 coordinates with the KMA short-range forecast Lambert grid."""

    earth_radius_km = 6371.00877
    grid_spacing_km = 5.0
    standard_parallel_1 = 30.0
    standard_parallel_2 = 60.0
    origin_longitude = 126.0
    origin_latitude = 38.0
    origin_x = 43.0
    origin_y = 136.0

    degrees_to_radians = pi / 180.0
    re = earth_radius_km / grid_spacing_km
    slat1 = standard_parallel_1 * degrees_to_radians
    slat2 = standard_parallel_2 * degrees_to_radians
    olon = origin_longitude * degrees_to_radians
    olat = origin_latitude * degrees_to_radians

    sn = tan(pi * 0.25 + slat2 * 0.5) / tan(pi * 0.25 + slat1 * 0.5)
    sn = log(cos(slat1) / cos(slat2)) / log(sn)
    sf = tan(pi * 0.25 + slat1 * 0.5)
    sf = (sf**sn) * cos(slat1) / sn
    ro = tan(pi * 0.25 + olat * 0.5)
    ro = re * sf / (ro**sn)

    ra = tan(pi * 0.25 + latitude * degrees_to_radians * 0.5)
    ra = re * sf / (ra**sn)
    theta = longitude * degrees_to_radians - olon
    if theta > pi:
        theta -= 2.0 * pi
    if theta < -pi:
        theta += 2.0 * pi
    theta *= sn

    nx = floor(ra * sin(theta) + origin_x + 0.5)
    ny = floor(ro - ra * cos(theta) + origin_y + 0.5)
    return GridCoordinate(nx=nx, ny=ny)


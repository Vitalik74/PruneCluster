/// <reference path="bower_components/DefinitelyTyped/Leaflet/Leaflet.d.ts"/>

module PruneCluster {
	export declare class LeafletAdapter implements L.ILayer {
		Cluster: PruneCluster;

		onAdd: (map: L.Map) => void;
		onRemove: (map: L.Map) => void;

		RegisterMarker: (marker: Marker) => void;
		RemoveMarkers: (markers: Marker[]) => void;
		ProcessView: () => void;
		FitBounds: () => void;
		GetMarkers: () => Marker[];

		BuildLeafletCluster: (cluster: Cluster, position: L.LatLng) => L.ILayer;
		BuildLeafletClusterIcon: (cluster: Cluster) => L.Icon;
		BuildLeafletMarker: (marker: Marker, position: L.LatLng) => L.Marker;
		PrepareLeafletMarker: (marker: L.Marker, data: {}, category: number) => void;
	}

	export interface LeafletMarker extends L.Marker {
		_population?: number;
		_hashCode?: number;
		_zoomLevel?: number;
		_removeFromMap?: boolean;
	}

	export interface ILeafletAdapterData {
		_leafletMarker?: LeafletMarker;
		_leafletCollision?: boolean;
		_leafletOldPopulation?: number;
		_leafletOldHashCode?: number;
		_leafletPosition?: L.LatLng;
	}
}


var PruneClusterForLeaflet = ((<any>L).Layer ? (<any>L).Layer : L.Class).extend({
	initialize: function(size: number = 120, clusterMargin: number = 20) {
		this.Cluster = new PruneCluster.PruneCluster();
		this.Cluster.Size = size;
		this.clusterMargin = Math.min(clusterMargin, size / 4);

		this.Cluster.Project = (lat: number, lng: number) =>
			this._map.project(new L.LatLng(lat, lng));

		this.Cluster.UnProject = (x: number, y: number) =>
			this._map.unproject(new L.Point(x, y));

		this._objectsOnMap = [];

		this.spiderfier = new PruneClusterLeafletSpiderfier(this);
	},

	RegisterMarker: function(marker: PruneCluster.Marker) {
		this.Cluster.RegisterMarker(marker);
	},

	RemoveMarkers: function(markers: PruneCluster.Marker[]) {
		this.Cluster.RemoveMarkers(markers);
	},

	BuildLeafletCluster: function(cluster: PruneCluster.Cluster, position: L.LatLng): L.ILayer {
		var m = new L.Marker(position, {
			icon: this.BuildLeafletClusterIcon(cluster)
		});

		m.on('click', () => {
			var markersArea = this.Cluster.FindMarkersInArea(cluster.bounds);
			var b = this.Cluster.ComputeBounds(markersArea);

			if (b) {

				var bounds = new L.LatLngBounds(
					new L.LatLng(b.minLat, b.maxLng),
					new L.LatLng(b.maxLat, b.minLng));

				var zoomLevelBefore = this._map.getZoom(),
					zoomLevelAfter = this._map.getBoundsZoom(bounds, false, new L.Point(20, 20));

				if (zoomLevelAfter === zoomLevelBefore) {
					this._map.fire('overlappingmarkers', { markers: markersArea, center: m.getLatLng(), marker: m });
					this._map.setView(position, zoomLevelAfter);
				} else {
					this._map.fitBounds(bounds);
				}

			}
		});

		return m;
	},

	BuildLeafletClusterIcon: (cluster: PruneCluster.Cluster): L.Icon => {
		var c = 'prunecluster prunecluster-';
		var iconSize = 38;
		if (cluster.population < 10) {
			c += 'small';
		} else if (cluster.population < 100) {
			c += 'medium';
			iconSize = 40;
		} else {
			c += 'large';
			iconSize = 44;
		}

		return new L.DivIcon({
			html: "<div><span>" + cluster.population + "</span></div>",
			className: c,
			iconSize: L.point(iconSize, iconSize)
		});
	},

	BuildLeafletMarker: function (marker: PruneCluster.Marker, position: L.LatLng): L.Marker {
		var m = new L.Marker(position);
		this.PrepareLeafletMarker(m, marker.data, marker.category);
		return m;
	},

	PrepareLeafletMarker: (marker: L.Marker, data: {}, category: number) => {
	},

	onAdd: function(map: L.Map) {
		this._map = map;
		map.on('movestart', this._moveStart, this);
		map.on('moveend', this._moveEnd, this);
		map.on('zoomend', this._zoomStart, this);
		map.on('zoomend', this._zoomEnd, this);
		this.ProcessView();

		map.addLayer(this.spiderfier);
	},

	onRemove: function(map: L.Map) {

		map.off('movestart', this._moveStart, this);
		map.off('moveend', this._moveEnd, this);
		map.off('zoomend', this._zoomStart, this);
		map.off('zoomend', this._zoomEnd, this);

		for (var i = 0, l = this._objectsOnMap.length; i < l; ++i) {
			map.removeLayer(this._objectsOnMap[i].data._leafletMarker);
		}

		this._objectsOnMap = [];
		this.Cluster.ResetClusters();

		map.removeLayer(this.spiderfier);

		this._map = null;
	},

	_moveStart: function() {
		this._moveInProgress = true;
	},

	_moveEnd: function(e) {
		this._moveInProgress = false;
		this._hardMove = e.hard;
		this.ProcessView();
	},

	_zoomStart: function() {
		this._zoomInProgress = true;
	},

	_zoomEnd: function() {
		this._zoomInProgress = false;
		this.ProcessView();
	},

	ProcessView: function() {
		if (!this._map || this._zoomInProgress || this._moveInProgress) {
			return;
		}

		var map = this._map,
			bounds = map.getBounds(),
			zoom = map.getZoom(),
			marginRatio = this.clusterMargin / this.Cluster.Size;

		var southWest = bounds.getSouthWest(),
			northEast = bounds.getNorthEast();

//		var t = +new Date();
		var clusters: PruneCluster.Cluster[] = this.Cluster.ProcessView({
			minLat: southWest.lat,
			minLng: southWest.lng,
			maxLat: northEast.lat,
			maxLng: northEast.lng
		});

		var objectsOnMap: PruneCluster.Cluster[] = this._objectsOnMap,
			newObjectsOnMap: PruneCluster.Cluster[] = [];

		// By default, all the objects should be removed
		// the removeFromMap property will be 
		for (var i = 0, l = objectsOnMap.length; i < l; ++i) {
			(<PruneCluster.ILeafletAdapterData>objectsOnMap[i].data)._leafletMarker._removeFromMap = true;
		}

		var clusterCreationList: PruneCluster.Cluster[] = [];

		var opacityUpdateList = [];

		// Anti collapsing system
		var workingList: PruneCluster.Cluster[] = [];

		for (i = 0, l = clusters.length; i < l; ++i) {
			var icluster = clusters[i],
				iclusterData = <PruneCluster.ILeafletAdapterData> icluster.data;

			var latMargin = (icluster.bounds.maxLat - icluster.bounds.minLat) * marginRatio,
				lngMargin = (icluster.bounds.maxLng - icluster.bounds.minLng) * marginRatio;

			for (var j = 0, ll = workingList.length; j < ll; ++j) {
				var c = workingList[j];
				if (c.bounds.maxLng < icluster.bounds.minLng) {
					workingList.splice(j, 1);
					--j;
					--ll;
					continue;
				}

				var oldMaxLng = c.averagePosition.lng + lngMargin,
					oldMinLat = c.averagePosition.lat - latMargin,
					oldMaxLat = c.averagePosition.lat + latMargin,
					newMinLng = icluster.averagePosition.lng - lngMargin,
					newMinLat = icluster.averagePosition.lat - latMargin,
					newMaxLat = icluster.averagePosition.lat + latMargin;

				if (oldMaxLng > newMinLng && oldMaxLat > newMinLat && oldMinLat < newMaxLat) {
					iclusterData._leafletCollision = true;
					//c.data._leafletCollision = true;
					c.ApplyCluster(icluster);
					break;
				}
			}

			if (!iclusterData._leafletCollision) {
				workingList.push(icluster);
			}

		}

		clusters.forEach((cluster: PruneCluster.Cluster) => {
			var m = undefined;
			var position: L.LatLng;
			var data = <PruneCluster.ILeafletAdapterData> cluster.data;

			//latMargin = (cluster.bounds.maxLat - cluster.bounds.minLat) * marginRatio;
			//lngMargin = (cluster.bounds.maxLng - cluster.bounds.minLng) * marginRatio;

			if (data._leafletCollision) {
				data._leafletCollision = false;
				data._leafletOldPopulation = 0;
				data._leafletOldHashCode = 0;
				return;
			} else {
				position = new L.LatLng(cluster.averagePosition.lat, cluster.averagePosition.lng);
			}

			var oldMarker = data._leafletMarker;
			if (oldMarker) {
				if (cluster.population === 1 && data._leafletOldPopulation === 1 && cluster.hashCode === oldMarker._hashCode) {
					if (oldMarker._zoomLevel !== zoom) {
						this.PrepareLeafletMarker(
							oldMarker,
							cluster.lastMarker.data,
							cluster.lastMarker.category);
					}
					oldMarker.setLatLng(position);
					m = oldMarker;
				} else if (cluster.population > 1 && data._leafletOldPopulation > 1 && (oldMarker._zoomLevel === zoom ||
					data._leafletPosition.equals(position))) {
					oldMarker.setLatLng(position);

					if (cluster.population != data._leafletOldPopulation ||
						cluster.hashCode !== data._leafletOldHashCode) {
						oldMarker.setIcon(this.BuildLeafletClusterIcon(cluster));
					}

					data._leafletOldPopulation = cluster.population;
					data._leafletOldHashCode = cluster.hashCode;
					m = oldMarker;
				}

			}

			if (!m) {
				clusterCreationList.push(cluster);

				data._leafletPosition = position;
				data._leafletOldPopulation = cluster.population;
				data._leafletOldHashCode = cluster.hashCode;
			} else {
				m._removeFromMap = false;
				m._zoomLevel = zoom;
				m._hashCode = cluster.hashCode;
				m._population = cluster.population;
				data._leafletMarker = m;
				data._leafletPosition = position;
				newObjectsOnMap.push(cluster);
			}

		});

		var toRemove = [];
		for (i = 0, l = objectsOnMap.length; i < l; ++i) {
			icluster = objectsOnMap[i];
			var idata =  <PruneCluster.ILeafletAdapterData> icluster.data,
				marker = idata._leafletMarker;

			if (idata._leafletMarker._removeFromMap) {

				var remove = true;

				if (marker._zoomLevel === zoom) {
					var pa = icluster.averagePosition;

					latMargin = (icluster.bounds.maxLat - icluster.bounds.minLat) * marginRatio,
						lngMargin = (icluster.bounds.maxLng - icluster.bounds.minLng) * marginRatio;

					for (j = 0, ll = clusterCreationList.length; j < ll; ++j) {
						var jcluster = clusterCreationList[j],
							jdata = <PruneCluster.ILeafletAdapterData> jcluster.data;
						var pb = jcluster.averagePosition;

						var oldMinLng = pa.lng - lngMargin,
							newMaxLng = pb.lng + lngMargin;

						oldMaxLng = pa.lng + lngMargin;
						oldMinLat = pa.lat - latMargin;
						oldMaxLat = pa.lat + latMargin;
						newMinLng = pb.lng - lngMargin;
						newMinLat = pb.lat - latMargin;
						newMaxLat = pb.lat + latMargin;

						if (oldMaxLng > newMinLng && oldMinLng < newMaxLng && oldMaxLat > newMinLat && oldMinLat < newMaxLat) {

							if (marker._population === 1 && jcluster.population === 1 &&
								marker._hashCode === jcluster.hashCode) {
								this.PrepareLeafletMarker(
									marker,
									jcluster.lastMarker.data,
									jcluster.lastMarker.category);
								marker.setLatLng(jdata._leafletPosition);
								remove = false;
							} else if (marker._population > 1 && jcluster.population > 1) {
								marker.setLatLng(jdata._leafletPosition);
								remove = false;
								marker.setIcon(this.BuildLeafletClusterIcon(jcluster));
								jdata._leafletOldPopulation = jcluster.population;
								jdata._leafletOldHashCode = jcluster.hashCode;
								marker._population = jcluster.population;
							}

							if (!remove) {

								jdata._leafletMarker = marker;
								newObjectsOnMap.push(jcluster);

								clusterCreationList.splice(j, 1);
								--j;
								--ll;

								break;
							}
						}
					}
				}

				if (remove) {
					if (!this._hardMove) {
						idata._leafletMarker.setOpacity(0);
					}
					toRemove.push(idata._leafletMarker);
				}
			}
		}

		for (i = 0, l = clusterCreationList.length; i < l; ++i) {
			icluster = clusterCreationList[i],
			idata = <PruneCluster.ILeafletAdapterData> icluster.data;

			var iposition = idata._leafletPosition;

			var creationMarker: any;
			if (icluster.population === 1) {
				creationMarker = this.BuildLeafletMarker(icluster.lastMarker, iposition);
			} else {
				creationMarker = this.BuildLeafletCluster(icluster, iposition);
			}

			creationMarker.addTo(map);
			L.DomUtil.addClass(creationMarker._icon, "no-anim");
			creationMarker.setOpacity(0);
			creationMarker._zoomLevel = zoom;
			creationMarker._hashCode = icluster.hashCode;
			creationMarker._population = icluster.population;
			opacityUpdateList.push(creationMarker);

			idata._leafletMarker = creationMarker;

			newObjectsOnMap.push(icluster);
		}

		window.setTimeout(() => {
			for (i = 0, l = opacityUpdateList.length; i < l; ++i) {
				var m = opacityUpdateList[i];
				L.DomUtil.removeClass(m._icon, "no-anim");
				m.setOpacity(1);
			}
		}, 1);

		if (toRemove.length > 0) {
			if (this._hardMove) {
				for (i = 0, l = toRemove.length; i < l; ++i) {
					map.removeLayer(toRemove[i]);
				}
			} else {
				window.setTimeout(() => {
					for (i = 0, l = toRemove.length; i < l; ++i) {
						map.removeLayer(toRemove[i]);
					}
				}, 300);
			}
		}

		this._objectsOnMap = newObjectsOnMap;
		this._hardMove = false;
	},

	FitBounds: function() {
		var bounds: PruneCluster.Bounds = this.Cluster.ComputeGlobalBounds();
		if (bounds) {
			this._map.fitBounds(new L.LatLngBounds(
				new L.LatLng(bounds.minLat, bounds.maxLng),
				new L.LatLng(bounds.maxLat, bounds.minLng)));
		}
	},

	GetMarkers: function() {
		return this.Cluster.GetMarkers();
	}
});

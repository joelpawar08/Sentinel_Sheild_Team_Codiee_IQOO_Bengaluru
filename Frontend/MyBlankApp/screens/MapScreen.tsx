// screens/MapScreen.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  Linking,
  Dimensions,
  Platform,
  Animated,
  PanResponder,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import { useAudioPlayer } from "expo-audio";
import axios from "axios";
import Navbar from "../components/Navbar";

const isWeb = Platform.OS === "web";
let MapView: any, Marker: any, Circle: any, Polyline: any, PROVIDER_DEFAULT: any;
if (!isWeb) {
  const Maps   = require("react-native-maps");
  MapView          = Maps.default;
  Marker           = Maps.Marker;
  Circle           = Maps.Circle;
  Polyline         = Maps.Polyline;
  PROVIDER_DEFAULT = Maps.PROVIDER_DEFAULT;
}

const DANGER_API    = "https://sentinel-shield-m-indicator-hacks.onrender.com/danger-status";
const DANGER_RADIUS = 2000;
const { height: SH } = Dimensions.get("window");
const SHEET_HEIGHT   = SH * 0.50;
const NAVBAR_H       = 72;

// ── Dark map style ─────────────────────────────────────────────────────────
const DARK_MAP_STYLE = [
  { elementType: "geometry",              stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.stroke",    stylers: [{ color: "#1a1a2e" }] },
  { elementType: "labels.text.fill",      stylers: [{ color: "#8b92ab" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#c5cae9" }] },
  { featureType: "poi",                   elementType: "labels.text.fill",   stylers: [{ color: "#6b7a99" }] },
  { featureType: "poi.park",              elementType: "geometry",           stylers: [{ color: "#1e3a3a" }] },
  { featureType: "poi.park",              elementType: "labels.text.fill",   stylers: [{ color: "#4a7c59" }] },
  { featureType: "road",                  elementType: "geometry",           stylers: [{ color: "#2c3e50" }] },
  { featureType: "road",                  elementType: "geometry.stroke",    stylers: [{ color: "#1a252f" }] },
  { featureType: "road",                  elementType: "labels.text.fill",   stylers: [{ color: "#9ca5b3" }] },
  { featureType: "road.highway",          elementType: "geometry",           stylers: [{ color: "#34495e" }] },
  { featureType: "road.highway",          elementType: "geometry.stroke",    stylers: [{ color: "#1f2c3a" }] },
  { featureType: "road.highway",          elementType: "labels.text.fill",   stylers: [{ color: "#b0bec5" }] },
  { featureType: "transit",               elementType: "geometry",           stylers: [{ color: "#2c3e50" }] },
  { featureType: "transit.station",       elementType: "labels.text.fill",   stylers: [{ color: "#7986cb" }] },
  { featureType: "water",                 elementType: "geometry",           stylers: [{ color: "#0f1419" }] },
  { featureType: "water",                 elementType: "labels.text.fill",   stylers: [{ color: "#3d5a80" }] },
  { featureType: "water",                 elementType: "labels.text.stroke", stylers: [{ color: "#0f1419" }] },
];

const EMERGENCY_CONTACTS = [
  { id: "1", label: "Ambulance",        number: "102",  color: "#FF3B30" },
  { id: "2", label: "Police",           number: "100",  color: "#1C1C1E" },
  { id: "3", label: "Disaster Mgmt",    number: "108",  color: "#FF9500" },
  { id: "4", label: "Women Helpline",   number: "1091", color: "#AF52DE" },
  { id: "5", label: "Fire Brigade",     number: "101",  color: "#FF6B35" },
  { id: "6", label: "Accident Report",  number: "1073", color: "#34C759" },
];

type PlaceType = "hospital" | "police";
interface Place { id: string; name: string; lat: number; lon: number; type: PlaceType; }

const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R    = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const placeColor = (t: PlaceType) => (t === "hospital" ? "#FF3B30" : "#1C1C1E");
const placeLabel = (t: PlaceType) => (t === "hospital" ? "Hospital"       : "Police Stn");
const fmtDist    = (m: number)     => (m < 1000       ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

// ────────────────────────────────────────────────────────────────────────────
export default function MapScreen() {
  const [location,      setLocation]      = useState<{ latitude: number; longitude: number } | null>(null);
  const [danger,        setDanger]        = useState(false);
  const [places,        setPlaces]        = useState<Place[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [activeTab,     setActiveTab]     = useState<"nearby" | "contacts">("nearby");
  const [routeCoords,   setRouteCoords]   = useState<{ latitude: number; longitude: number }[]>([]);
  const [waypoints,     setWaypoints]     = useState<{ latitude: number; longitude: number }[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [sheetOpen,     setSheetOpen]     = useState(false);

  const mapRef     = useRef<any>(null);
  // Sheet slides in from bottom: translateY goes from SHEET_HEIGHT (hidden) → 0 (visible)
  const sheetTransY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const pulseAnim   = useRef(new Animated.Value(1)).current;
  const sheetOpenRef = useRef(false); // ref mirror so PanResponder can read it sync

  // ── expo-audio ─────────────────────────────────────────────────────────
  const player = useAudioPlayer(require("../assets/alert.mp3"));

  const startSiren = useCallback(() => {
    try { player.loop = true; player.play(); }
    catch (e) { console.log("siren:", e); }
  }, [player]);

  const stopSiren = useCallback(() => {
    try { player.pause(); player.seekTo(0); }
    catch (e) { console.log("siren stop:", e); }
  }, [player]);

  // ── Collapse sheet on screen blur ──────────────────────────────────────
  useFocusEffect(
    useCallback(() => {
      return () => closeSheet();
    }, [])
  );

  // ── Danger pulse animation ──────────────────────────────────────────────
  useEffect(() => {
    if (danger) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.14, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1,    duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [danger]);

  // ── Danger poll every 3 s ──────────────────────────────────────────────
  useEffect(() => {
    const poll = async () => {
      try {
        const res      = await axios.get(DANGER_API);
        const isDanger = !!res.data.danger_zone;
        setDanger((prev) => {
          if (isDanger && !prev) startSiren();
          if (!isDanger && prev) { stopSiren(); setRouteCoords([]); setSelectedPlace(null); }
          return isDanger;
        });
      } catch { /* silent */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [startSiren, stopSiren]);

  // ── Location + places ──────────────────────────────────────────────────
  useEffect(() => {
    let sub: any;
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") { setLoading(false); return; }

      const loc    = await Location.getCurrentPositionAsync({});
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);

      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 15 },
        (l) => setLocation({ latitude: l.coords.latitude, longitude: l.coords.longitude })
      );

      await fetchNearby(coords.latitude, coords.longitude);
      setLoading(false);
    })();
    return () => sub?.remove();
  }, []);

  // ── Nominatim OSM (no 406 issues) ─────────────────────────────────────
  const fetchNearby = async (lat: number, lon: number) => {
    const d   = 0.10;
    const box = `${lon - d},${lat - d},${lon + d},${lat + d}`;
    const BASE = "https://nominatim.openstreetmap.org/search";
    const HDRS = { "User-Agent": "SentinelShield/1.0 (safety-app)" };
    const TYPES: Array<{ amenity: string; type: PlaceType; fallback: string }> = [
      { amenity: "hospital",     type: "hospital", fallback: "Hospital"       },
      { amenity: "clinic",       type: "hospital", fallback: "Clinic"         },
      { amenity: "police",       type: "police",   fallback: "Police Station" },
      { amenity: "fire_station", type: "police",   fallback: "Fire Station"   },
    ];

    try {
      const results = await Promise.allSettled(
        TYPES.map(({ amenity, type, fallback }) =>
          axios.get(BASE, {
            params: { amenity, format: "json", limit: 10, bounded: 1, viewbox: box },
            headers: HDRS,
            timeout: 12000,
          }).then((res) =>
            (res.data as any[]).map((el): Place => ({
              id:   `${amenity}-${el.osm_id}`,
              name: (el.display_name?.split(",")[0] || fallback).trim(),
              lat:  parseFloat(el.lat),
              lon:  parseFloat(el.lon),
              type,
            }))
          )
        )
      );

      const all: Place[] = results.flatMap((r) => r.status === "fulfilled" ? r.value : []);

      const seen  = new Set<string>();
      const dedup = all.filter((p) => {
        const key = `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      dedup.sort((a, b) => getDistance(lat, lon, a.lat, a.lon) - getDistance(lat, lon, b.lat, b.lon));
      setPlaces(dedup.slice(0, 10));
      console.log(`Nominatim: ${all.length} raw → ${dedup.length} dedup → ${Math.min(dedup.length, 10)} shown`);
    } catch (e: any) {
      console.log("Nominatim error:", e?.response?.status, e?.message);
    }
  };

  // ── OSRM route ────────────────────────────────────────────────────────
  const navigateTo = async (place: Place) => {
    if (!location) return;
    setSelectedPlace(place);
    setRouteCoords([]);
    setWaypoints([]);

    try {
      const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${location.longitude},${location.latitude};${place.lon},${place.lat}` +
        `?overview=full&geometries=geojson&steps=true`;
      const res = await axios.get(url, { timeout: 12000 });

      if (res.data.routes?.length) {
        const route  = res.data.routes[0];
        const coords = route.geometry.coordinates.map((c: number[]) => ({
          latitude: c[1], longitude: c[0],
        }));
        setRouteCoords(coords);

        const wps: { latitude: number; longitude: number }[] = [];
        (route.legs?.[0]?.steps ?? []).forEach((step: any) => {
          const loc = step.maneuver?.location;
          if (loc) wps.push({ longitude: loc[0], latitude: loc[1] });
        });
        setWaypoints(wps);

        mapRef.current?.fitToCoordinates(coords, {
          edgePadding: { top: 100, right: 60, bottom: 300, left: 60 },
          animated: true,
        });
      }
    } catch (e) { console.log("Route error:", e); }
  };

  const clearRoute = () => { setSelectedPlace(null); setRouteCoords([]); setWaypoints([]); };

  // ── Sheet open / close helpers ─────────────────────────────────────────
  const openSheet = () => {
    sheetOpenRef.current = true;
    setSheetOpen(true);
    Animated.spring(sheetTransY, {
      toValue: 0, useNativeDriver: true, bounciness: 4,
    }).start();
  };

  const closeSheet = () => {
    sheetOpenRef.current = false;
    setSheetOpen(false);
    Animated.spring(sheetTransY, {
      toValue: SHEET_HEIGHT, useNativeDriver: true, bounciness: 4,
    }).start();
  };

  const toggleSheet = () => (sheetOpenRef.current ? closeSheet() : openSheet());

  // ── PanResponder: drag handle down to close ────────────────────────────
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder:  (_, g) => Math.abs(g.dy) > 8,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) sheetTransY.setValue(g.dy); // only allow dragging down
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.4) {
          closeSheet();
        } else {
          // snap back open
          Animated.spring(sheetTransY, { toValue: 0, useNativeDriver: true, bounciness: 4 }).start();
        }
      },
    })
  ).current;

  // ── Loading / web ──────────────────────────────────────────────────────
  if (loading || !location) {
    return (
      <View style={s.loader}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={s.loaderTxt}>Locating you…</Text>
      </View>
    );
  }

  if (isWeb) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ color: "#555", fontSize: 15 }}>Map available in Expo Go only</Text>
        </View>
        <Navbar />
      </SafeAreaView>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────
  return (
    <View style={s.root}>

      {/* ── FULL-SCREEN MAP ── */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_DEFAULT}
        style={StyleSheet.absoluteFill}
        customMapStyle={DARK_MAP_STYLE}
        initialRegion={{
          latitude:       location.latitude,
          longitude:      location.longitude,
          latitudeDelta:  0.04,
          longitudeDelta: 0.04,
        }}
        showsUserLocation
        showsMyLocationButton
        showsCompass
        showsScale
        loadingEnabled
        loadingIndicatorColor="#007AFF"
        loadingBackgroundColor="#1a1a2e"
      >
        <Marker coordinate={location} title="You" pinColor="#007AFF" />

        {danger && (
          <Circle
            center={location}
            radius={DANGER_RADIUS}
            strokeColor="rgba(255,59,48,0.65)"
            fillColor="rgba(255,59,48,0.12)"
            strokeWidth={2}
          />
        )}

        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor="#2196F3" strokeWidth={5} />
        )}

        {waypoints.map((wp, i) => (
          <Marker key={`wp-${i}`} coordinate={wp} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={s.wpDot} />
          </Marker>
        ))}

        {selectedPlace && (
          <Marker
            coordinate={{ latitude: selectedPlace.lat, longitude: selectedPlace.lon }}
            title={selectedPlace.name}
            pinColor={placeColor(selectedPlace.type)}
          />
        )}

        {places.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            title={p.name}
            description={`${placeLabel(p.type)} — tap to route`}
            pinColor={placeColor(p.type)}
            onCalloutPress={() => navigateTo(p)}
          />
        ))}
      </MapView>

      {/* ── DANGER PILL ── */}
      {danger && (
        <Animated.View
          style={[s.dangerPill, { transform: [{ scale: pulseAnim }] }]}
          pointerEvents="none"
        >
          <View style={s.dangerDot} />
          <Text style={s.dangerPillTxt}>DANGER ZONE ACTIVE</Text>
        </Animated.View>
      )}

      {/* ── DESTINATION CARD ── */}
      {selectedPlace && routeCoords.length > 0 && (
        <View style={[s.destCard, danger && { top: 108 }]}>
          <View style={{ flex: 1 }}>
            <Text style={s.destName} numberOfLines={1}>{selectedPlace.name}</Text>
            <Text style={s.destDist}>
              {placeLabel(selectedPlace.type)}  ·  {fmtDist(getDistance(location.latitude, location.longitude, selectedPlace.lat, selectedPlace.lon))} away
            </Text>
          </View>
          <TouchableOpacity style={s.destClose} onPress={clearRoute}>
            <Text style={s.destCloseX}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── TOGGLE BUTTON — always on top, inside sheet when open ── */}
      <TouchableOpacity
        style={[s.toggleBtn, sheetOpen && s.toggleBtnInsideSheet]}
        onPress={toggleSheet}
        activeOpacity={0.85}
      >
        <Text style={s.toggleChevron}>{sheetOpen ? "▼" : "▲"}</Text>
        <Text style={s.toggleLabel}>{sheetOpen ? "Close" : "Nearby & Contacts"}</Text>
      </TouchableOpacity>

      {/* ── BOTTOM SHEET ── */}
      <Animated.View
        style={[s.sheet, { transform: [{ translateY: sheetTransY }] }]}
      >
        {/* Drag handle — also tap to close */}
        <View {...panResponder.panHandlers} style={s.handleWrap}>
          <View style={s.handle} />
        </View>

        {/* Tabs */}
        <View style={s.tabBar}>
          <TouchableOpacity
            style={[s.tabBtn, activeTab === "nearby" && s.tabBtnOn]}
            onPress={() => setActiveTab("nearby")}
          >
            <Text style={[s.tabTxt, activeTab === "nearby" && s.tabTxtOn]}>Nearby Places</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.tabBtn, activeTab === "contacts" && s.tabBtnOn]}
            onPress={() => setActiveTab("contacts")}
          >
            <Text style={[s.tabTxt, activeTab === "contacts" && s.tabTxtOn]}>Emergency</Text>
          </TouchableOpacity>
        </View>

        {/* ── Nearby tab ── */}
        {activeTab === "nearby" && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {places.length === 0 ? (
              <View style={{ alignItems: "center", paddingVertical: 30 }}>
                <ActivityIndicator color="#007AFF" />
                <Text style={s.emptyTxt}>Searching nearby places…</Text>
              </View>
            ) : (
              places.map((item, i) => {
                const dist     = getDistance(location.latitude, location.longitude, item.lat, item.lon);
                const isActive = selectedPlace?.id === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[s.placeRow, isActive && s.placeRowActive]}
                    onPress={() => navigateTo(item)}
                    activeOpacity={0.75}
                  >
                    {/* Index number */}
                    <View style={s.indexBadge}>
                      <Text style={s.indexTxt}>{i + 1}</Text>
                    </View>

                    {/* Info */}
                    <View style={{ flex: 1 }}>
                      <Text style={s.placeName} numberOfLines={1}>{item.name}</Text>
                      <Text style={s.placeMeta}>
                        {placeLabel(item.type)}
                        {"  ·  "}
                        {fmtDist(dist)}
                      </Text>
                    </View>

                    {/* Route pill */}
                    <View style={[
                      s.routePill,
                      { backgroundColor: isActive ? "#1C1C1E" : "#F3F4F6" },
                    ]}>
                      <Text style={[s.routePillTxt, { color: isActive ? "#fff" : "#1C1C1E" }]}>
                        {isActive ? "On Route" : "Route"}
                      </Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>
        )}

        {/* ── Contacts tab ── */}
        {activeTab === "contacts" && (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
            {EMERGENCY_CONTACTS.map((c) => (
              <View key={c.id} style={s.contactRow}>
                {/* Colored left bar */}
                <View style={[s.contactBar, { backgroundColor: c.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.contactLabel}>{c.label}</Text>
                  <Text style={s.contactNum}>{c.number}</Text>
                </View>
                <TouchableOpacity
                  style={s.callBtn}
                  onPress={() => Linking.openURL(`tel:${c.number}`)}
                >
                  <Text style={s.callBtnTxt}>Call</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}
      </Animated.View>

      {/* ── NAVBAR ── */}
      <SafeAreaView style={s.navbarWrap} edges={["bottom"]}>
        <Navbar />
      </SafeAreaView>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: "#000" },
  loader:    { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  loaderTxt: { marginTop: 12, fontSize: 15, color: "#888", fontWeight: "500" },

  // Danger pill
  dangerPill: {
    position: "absolute", top: 56, left: 18,
    backgroundColor: "#FF3B30",
    borderRadius: 26, paddingHorizontal: 18, paddingVertical: 11,
    flexDirection: "row", alignItems: "center", gap: 8,
    elevation: 12,
    shadowColor: "#FF3B30", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.55, shadowRadius: 10,
  },
  dangerDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#fff" },
  dangerPillTxt: { color: "#fff", fontSize: 13, fontWeight: "800", letterSpacing: 0.6 },

  // Destination card
  destCard: {
    position: "absolute", top: 56, right: 14, left: 14,
    backgroundColor: "#fff",
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", gap: 12,
    elevation: 10,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12, shadowRadius: 10,
  },
  destName:  { fontSize: 13, fontWeight: "700", color: "#111", letterSpacing: -0.2 },
  destDist:  { fontSize: 11, color: "#888", marginTop: 2 },
  destClose: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "#F3F4F6", justifyContent: "center", alignItems: "center",
  },
  destCloseX: { color: "#666", fontSize: 13, fontWeight: "700" },

  // Waypoint dot
  wpDot: {
    width: 10, height: 10, borderRadius: 5,
    backgroundColor: "#2196F3", borderWidth: 2, borderColor: "#fff",
  },

  // Toggle button — floats above sheet when closed, sits inside sheet top when open
  toggleBtn: {
    position: "absolute",
    bottom: NAVBAR_H + 14,
    alignSelf: "center",
    backgroundColor: "#fff",
    borderRadius: 30, paddingHorizontal: 22, paddingVertical: 12,
    flexDirection: "row", alignItems: "center", gap: 8,
    elevation: 14,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18, shadowRadius: 10,
    zIndex: 99,
  },
  // When sheet is open, the button sticks just above the handle inside the sheet
  toggleBtnInsideSheet: {
    bottom: SHEET_HEIGHT - 20,
  },
  toggleChevron: { fontSize: 13, color: "#1C1C1E", fontWeight: "800" },
  toggleLabel:   { fontSize: 14, color: "#1C1C1E", fontWeight: "600", letterSpacing: -0.2 },

  // Sheet
  sheet: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: SHEET_HEIGHT,
    backgroundColor: "#fff",
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 18,
    elevation: 20,
    shadowColor: "#000", shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1, shadowRadius: 16,
    zIndex: 50,
  },

  handleWrap: { alignItems: "center", paddingVertical: 14 },
  handle: {
    width: 40, height: 5, borderRadius: 3, backgroundColor: "#E0E0E0",
  },

  // Tabs
  tabBar: {
    flexDirection: "row", backgroundColor: "#F3F4F6",
    borderRadius: 12, padding: 4, marginBottom: 14,
  },
  tabBtn:   { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: "center" },
  tabBtnOn: { backgroundColor: "#fff", elevation: 2, shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3 },
  tabTxt:   { fontSize: 13, fontWeight: "600", color: "#999" },
  tabTxtOn: { color: "#1C1C1E", fontWeight: "700" },

  // Place row — clean, no emojis
  placeRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14, paddingHorizontal: 2,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6", gap: 12,
  },
  placeRowActive: {
    backgroundColor: "#F8F8F8",
    borderRadius: 12, borderBottomWidth: 0,
    paddingHorizontal: 10, marginBottom: 2,
  },
  indexBadge: {
    width: 30, height: 30, borderRadius: 8,
    backgroundColor: "#F3F4F6",
    justifyContent: "center", alignItems: "center",
  },
  indexTxt:  { fontSize: 13, fontWeight: "700", color: "#1C1C1E" },
  placeName: { fontSize: 13, fontWeight: "600", color: "#1C1C1E", letterSpacing: -0.2 },
  placeMeta: { fontSize: 11, color: "#888", marginTop: 2 },
  routePill: {
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7,
  },
  routePillTxt: { fontSize: 12, fontWeight: "700" },

  // Contact row — colored left bar, no emojis
  contactRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#F3F4F6", gap: 14,
  },
  contactBar:   { width: 4, height: 36, borderRadius: 2 },
  contactLabel: { fontSize: 13, fontWeight: "600", color: "#1C1C1E" },
  contactNum:   { fontSize: 12, color: "#888", fontWeight: "500", marginTop: 2 },
  callBtn: {
    backgroundColor: "#1C1C1E",
    borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10,
  },
  callBtnTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },

  emptyTxt: { color: "#aaa", fontSize: 13, marginTop: 10 },

  navbarWrap: { position: "absolute", bottom: 0, left: 0, right: 0 },
});

// done - Joel Pawar (AI Engineer)

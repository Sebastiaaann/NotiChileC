/* eslint-disable @typescript-eslint/no-require-imports */
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import React from "react";
import { FlatList } from "react-native";
import {
  DEFAULT_FEED_SORT_MODE,
  FEED_SORT_STORAGE_KEY,
} from "../../services/feed-sort";

const mockPush = jest.fn();
const mockFetchLicitaciones = jest.fn();
const mockFetchRubros = jest.fn();
const mockFetchRegions = jest.fn();
const mockSyncFeedFiltersPreferences = jest.fn();
const mockFeedFiltersStorage = {
  getItem: jest.fn<Promise<string | null>, [string]>(async () => null),
  setItem: jest.fn<Promise<void>, [string, string]>(async () => undefined),
  removeItem: jest.fn<Promise<void>, [string]>(async () => undefined),
  clear: jest.fn<Promise<void>, []>(async () => undefined),
};

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock("@expo/vector-icons", () => ({
  Ionicons: () => null,
}));

jest.mock("../../services/feed-filters-storage", () => ({
  feedFiltersStorage: mockFeedFiltersStorage,
}));

jest.mock("../../services/api", () => ({
  fetchLicitaciones: (...args: unknown[]) => mockFetchLicitaciones(...args),
  fetchRubros: (...args: unknown[]) => mockFetchRubros(...args),
  fetchRegions: (...args: unknown[]) => mockFetchRegions(...args),
}));

jest.mock("../../services/push-installation", () => ({
  syncFeedFiltersPreferences: (...args: unknown[]) =>
    mockSyncFeedFiltersPreferences(...args),
}));

jest.setTimeout(15000);

describe("LicitacionesFeed", () => {
  function createLicitacion(overrides: Record<string, unknown> = {}) {
    return {
      id: "licitacion-1",
      codigoExterno: "CODE-1",
      nombre: "Licitación de prueba",
      organismoNombre: "Municipalidad de Santiago",
      tipo: "L1",
      montoEstimado: 1500000,
      montoLabel: "$1.500.000",
      moneda: "CLP",
      fechaPublicacion: "2026-03-01T10:00:00.000Z",
      fechaCierre: "2026-03-05T10:00:00.000Z",
      estado: "Publicada",
      url: "https://example.com/licitacion-1",
      region: "RM",
      categoria: "General",
      rubroCode: "45000000",
      notificada: false,
      createdAt: "2026-03-01T10:00:00.000Z",
      ...overrides,
    };
  }

  function renderFeed() {
    const LicitacionesFeed = require("../../../app/(tabs)/index").default;
    return render(<LicitacionesFeed />);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncFeedFiltersPreferences.mockResolvedValue(undefined);
    mockFeedFiltersStorage.getItem.mockImplementation(async (key: string) => {
      if (key === FEED_SORT_STORAGE_KEY) {
        return DEFAULT_FEED_SORT_MODE;
      }

      return null;
    });

    mockFetchRubros.mockResolvedValue({
      data: [{ code: "45000000", name: "Construcción", parentCode: null }],
    });
    mockFetchRegions.mockResolvedValue({
      data: [{ name: "RM" }, { name: "Valparaíso" }],
    });
    mockFetchLicitaciones.mockResolvedValue({
      data: [],
      pageInfo: {
        limit: 20,
        hasMore: false,
        nextCursor: null,
        windowDays: 90,
        windowStart: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("restaura filtros persistidos y consulta con esos valores", async () => {
    mockFeedFiltersStorage.getItem.mockImplementation(async (key: string) => {
      if (key === FEED_SORT_STORAGE_KEY) {
        return DEFAULT_FEED_SORT_MODE;
      }

      return JSON.stringify({
        rubro: "45000000",
        tipo: "L1",
        region: "RM",
        montoMin: 100000000,
        montoMax: null,
        montoPresetId: "mas-100m",
      });
    });

    renderFeed();

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: "45000000",
          tipo: "L1",
          region: "RM",
          montoMin: 100000000,
          montoMax: null,
          montoPresetId: "mas-100m",
        },
      });
    });

    expect(mockFeedFiltersStorage.getItem).toHaveBeenCalled();
  });

  it("aplica filtro de región y vuelve a consultar desde página 1", async () => {
    mockFeedFiltersStorage.getItem.mockResolvedValue(null);

    renderFeed();

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    fireEvent.press(await screen.findByText("RM"));

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenLastCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: "RM",
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });
  });

  it("limpia filtros activos y vuelve al estado base", async () => {
    mockFeedFiltersStorage.getItem.mockImplementation(async (key: string) => {
      if (key === FEED_SORT_STORAGE_KEY) {
        return DEFAULT_FEED_SORT_MODE;
      }

      return JSON.stringify({
        rubro: null,
        tipo: "L1",
        region: "RM",
        montoMin: null,
        montoMax: 10000000,
        montoPresetId: "hasta-10m",
      });
    });

    renderFeed();

    const clearButtons = await screen.findAllByText("Limpiar filtros");
    fireEvent.press(clearButtons[0]);

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenLastCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });
  });

  it("usa nextCursor para cargar más resultados y evita pedir más cuando no hay más", async () => {
    mockFeedFiltersStorage.getItem.mockResolvedValue(null);
    mockFetchLicitaciones
      .mockResolvedValueOnce({
        data: [createLicitacion({ id: "licitacion-1", nombre: "Primera licitación" })],
        pageInfo: {
          limit: 20,
          hasMore: true,
          nextCursor: "cursor-2",
          windowDays: 90,
          windowStart: "2026-01-01T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: [createLicitacion({ id: "licitacion-2", nombre: "Segunda licitación" })],
        pageInfo: {
          limit: 20,
          hasMore: false,
          nextCursor: null,
          windowDays: 90,
          windowStart: "2026-01-01T00:00:00.000Z",
        },
      });

    const view = renderFeed();

    await screen.findByText("Primera licitación");

    const list = view.UNSAFE_getByType(FlatList);

    await act(async () => {
      list.props.onEndReached();
    });

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenLastCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: "cursor-2",
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    await screen.findByText("Segunda licitación");

    await act(async () => {
      list.props.onEndReached();
    });

    expect(mockFetchLicitaciones).toHaveBeenCalledTimes(2);
  });

  it("refresh vuelve a cursor null y reemplaza la lista", async () => {
    mockFeedFiltersStorage.getItem.mockResolvedValue(null);
    mockFetchLicitaciones
      .mockResolvedValueOnce({
        data: [createLicitacion({ id: "licitacion-1", nombre: "Resultado viejo" })],
        pageInfo: {
          limit: 20,
          hasMore: true,
          nextCursor: "cursor-refresh",
          windowDays: 90,
          windowStart: "2026-01-01T00:00:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        data: [createLicitacion({ id: "licitacion-2", nombre: "Resultado refrescado" })],
        pageInfo: {
          limit: 20,
          hasMore: false,
          nextCursor: null,
          windowDays: 90,
          windowStart: "2026-01-01T00:00:00.000Z",
        },
      });

    const view = renderFeed();

    await screen.findByText("Resultado viejo");

    const list = view.UNSAFE_getByType(FlatList);

    await act(async () => {
      list.props.refreshControl.props.onRefresh();
    });

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenLastCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    await screen.findByText("Resultado refrescado");
    expect(screen.queryByText("Resultado viejo")).not.toBeOnTheScreen();
  });

  it("continua sin romper si el storage falla al inicializar", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    mockFeedFiltersStorage.getItem.mockRejectedValueOnce(
      new Error("Storage indisponible")
    );

    renderFeed();

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    expect(screen.getByText("Filtros")).toBeOnTheScreen();

    consoleErrorSpy.mockRestore();
  });

  it("no intenta paginar si hasMore es false", async () => {
    mockFeedFiltersStorage.getItem.mockResolvedValue(null);
    mockFetchLicitaciones.mockResolvedValueOnce({
      data: [createLicitacion({ id: "licitacion-1", nombre: "Única licitación" })],
      pageInfo: {
        limit: 20,
        hasMore: false,
        nextCursor: null,
        windowDays: 90,
        windowStart: "2026-01-01T00:00:00.000Z",
      },
    });

    const view = renderFeed();

    await screen.findByText("Única licitación");

    const list = view.UNSAFE_getByType(FlatList);

    await act(async () => {
      list.props.onEndReached();
    });

    expect(mockFetchLicitaciones).toHaveBeenCalledTimes(1);
  });

  it("restaura el modo de orden persistido y consulta con ese valor", async () => {
    mockFeedFiltersStorage.getItem.mockImplementation(async (key: string) => {
      if (key === FEED_SORT_STORAGE_KEY) {
        return "closing_soon";
      }

      return null;
    });

    renderFeed();

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenCalledWith({
        sortMode: "closing_soon",
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    expect(screen.getAllByText("Prontas a cerrar").length).toBeGreaterThan(0);
  });

  it("cambiar el modo de orden refresca el feed y lo persiste sin resincronizar notificaciones", async () => {
    renderFeed();

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenCalledWith({
        sortMode: DEFAULT_FEED_SORT_MODE,
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    await waitFor(() => {
      expect(mockSyncFeedFiltersPreferences).toHaveBeenCalledTimes(1);
    });

    mockSyncFeedFiltersPreferences.mockClear();

    fireEvent.press(await screen.findByText("Más relevantes"));

    await waitFor(() => {
      expect(mockFetchLicitaciones).toHaveBeenLastCalledWith({
        sortMode: "most_relevant",
        cursor: null,
        limit: 20,
        windowDays: 90,
        filters: {
          rubro: null,
          tipo: null,
          region: null,
          montoMin: null,
          montoMax: null,
          montoPresetId: null,
        },
      });
    });

    await waitFor(() => {
      expect(mockFeedFiltersStorage.setItem).toHaveBeenCalledWith(
        FEED_SORT_STORAGE_KEY,
        "most_relevant"
      );
    });

    expect(mockSyncFeedFiltersPreferences).not.toHaveBeenCalled();
  });
});

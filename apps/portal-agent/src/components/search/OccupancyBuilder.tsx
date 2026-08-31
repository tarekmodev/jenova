"use client";

/**
 * Multi-room / multi-pax occupancy builder (issue #96): up to 9 rooms,
 * 1-9 adults each, child ages 0-17 — mirrors the api's search body limits.
 */

import {
  Button,
  Card,
  CardContent,
  FormField,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@jenova/ui";
import type { ReactNode } from "react";
import { useMessages } from "../../i18n/I18nProvider";
import type { RoomOccupancyInput } from "../../lib/types";

const MAX_ROOMS = 9;
const DEFAULT_CHILD_AGE = 7;

export function OccupancyBuilder(props: {
  rooms: readonly RoomOccupancyInput[];
  onChange: (rooms: readonly RoomOccupancyInput[]) => void;
}): ReactNode {
  const messages = useMessages();
  const { rooms, onChange } = props;

  const updateRoom = (index: number, patch: Partial<RoomOccupancyInput>): void => {
    onChange(rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)));
  };

  return (
    <Stack spacing={1.5}>
      <Typography variant="subtitle2">{messages.search.rooms}</Typography>
      {rooms.map((room, index) => (
        <Card key={index} variant="outlined">
          <CardContent sx={{ paddingBlock: 1.5, "&:last-child": { paddingBlockEnd: 1.5 } }}>
            <Stack spacing={1.5}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2">
                  {messages.search.room} {index + 1}
                </Typography>
                {rooms.length > 1 && (
                  <Button
                    size="small"
                    color="error"
                    onClick={() => onChange(rooms.filter((_, i) => i !== index))}
                  >
                    {messages.search.removeRoom}
                  </Button>
                )}
              </Stack>
              <Stack direction="row" spacing={2} useFlexGap flexWrap="wrap">
                <FormField label={messages.search.adults}>
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      size="small"
                      value={room.adults}
                      onChange={(event) =>
                        updateRoom(index, { adults: Number(event.target.value) })
                      }
                      data-testid={`room-${String(index)}-adults`}
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label={messages.search.children}>
                  {(fieldId) => (
                    <Select
                      id={fieldId}
                      size="small"
                      value={room.childAges.length}
                      onChange={(event) => {
                        const count = Number(event.target.value);
                        const ages = [...room.childAges];
                        while (ages.length < count) ages.push(DEFAULT_CHILD_AGE);
                        updateRoom(index, { childAges: ages.slice(0, count) });
                      }}
                      data-testid={`room-${String(index)}-children`}
                    >
                      {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                        <MenuItem key={n} value={n}>
                          {n}
                        </MenuItem>
                      ))}
                    </Select>
                  )}
                </FormField>
                {room.childAges.map((age, childIndex) => (
                  <FormField key={childIndex} label={`${messages.search.childAge} ${String(childIndex + 1)}`}>
                    {(fieldId) => (
                      <TextField
                        id={fieldId}
                        size="small"
                        type="number"
                        value={age}
                        onChange={(event) => {
                          const next = Math.min(17, Math.max(0, Number(event.target.value)));
                          updateRoom(index, {
                            childAges: room.childAges.map((a, i) => (i === childIndex ? next : a)),
                          });
                        }}
                        sx={{ width: 90 }}
                      />
                    )}
                  </FormField>
                ))}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      ))}
      {rooms.length < MAX_ROOMS && (
        <Stack direction="row">
          <Button size="small" onClick={() => onChange([...rooms, { adults: 2, childAges: [] }])}>
            {messages.search.addRoom}
          </Button>
        </Stack>
      )}
    </Stack>
  );
}

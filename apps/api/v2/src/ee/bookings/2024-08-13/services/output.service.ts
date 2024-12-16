import { BookingsRepository_2024_08_13 } from "@/ee/bookings/2024-08-13/bookings.repository";
import {
  defaultBookingMetadata,
  defaultBookingResponses,
  defaultSeatedBookingData,
  defaultSeatedBookingMetadata,
} from "@/lib/safe-parse/default-responses-booking";
import { safeParse } from "@/lib/safe-parse/safe-parse";
import { Injectable } from "@nestjs/common";
import { plainToClass } from "class-transformer";
import { DateTime } from "luxon";
import { z } from "zod";

import { bookingMetadataSchema } from "@calcom/platform-libraries";
import {
  BookingOutput_2024_08_13,
  CreateRecurringSeatedBookingOutput_2024_08_13,
  CreateSeatedBookingOutput_2024_08_13,
  GetRecurringSeatedBookingOutput_2024_08_13,
  GetSeatedBookingOutput_2024_08_13,
  ReassignBookingOutput_2024_08_13,
  RecurringBookingOutput_2024_08_13,
  SeatedAttendee,
} from "@calcom/platform-types";
import { Booking, BookingSeat } from "@calcom/prisma/client";

export const bookingResponsesSchema = z
  .object({
    email: z.string(),
    name: z.union([
      z.string(),
      z.object({
        firstName: z.string(),
        lastName: z.string(),
      }),
    ]),
    guests: z.array(z.string()).optional(),
    rescheduleReason: z.string().optional(),
  })
  .passthrough()
  .describe("BookingResponses");

export const seatedBookingDataSchema = z
  .object({
    responses: z
      .object({
        email: z.string(),
        name: z.union([
          z.string(),
          z.object({
            firstName: z.string(),
            lastName: z.string(),
          }),
        ]),
      })
      .passthrough(),
  })
  .passthrough()
  .describe("SeatedBookingData");

const seatedBookingMetadataSchema = z.object({}).catchall(z.string()).describe("SeatedBookingMetadata");

type DatabaseUser = { id: number; name: string | null; email: string; username: string | null };

type DatabaseBooking = Booking & {
  eventType: {
    id: number;
    slug: string;
  } | null;
  attendees: {
    name: string;
    email: string;
    timeZone: string;
    locale: string | null;
    noShow: boolean | null;
    bookingSeat?: BookingSeat | null;
  }[];
  user: DatabaseUser | null;
  createdAt: Date;
};

type BookingWithUser = Booking & { user: DatabaseUser | null };

type DatabaseMetadata = z.infer<typeof bookingMetadataSchema>;

@Injectable()
export class OutputBookingsService_2024_08_13 {
  constructor(private readonly bookingsRepository: BookingsRepository_2024_08_13) {}

  getOutputBooking(databaseBooking: DatabaseBooking) {
    const dateStart = DateTime.fromISO(databaseBooking.startTime.toISOString());
    const dateEnd = DateTime.fromISO(databaseBooking.endTime.toISOString());
    const duration = dateEnd.diff(dateStart, "minutes").minutes;
    const bookingResponses = safeParse(
      bookingResponsesSchema,
      databaseBooking.responses,
      defaultBookingResponses
    );
    const metadata = safeParse(bookingMetadataSchema, databaseBooking.metadata, defaultBookingMetadata);
    const location = metadata?.videoCallUrl || databaseBooking.location;

    const booking = {
      id: databaseBooking.id,
      uid: databaseBooking.uid,
      title: databaseBooking.title,
      description: databaseBooking.description,
      hosts: [this.getHost(databaseBooking.user)],
      status: databaseBooking.status.toLowerCase(),
      cancellationReason: databaseBooking.cancellationReason || undefined,
      reschedulingReason: bookingResponses?.rescheduledReason,
      rescheduledFromUid: databaseBooking.fromReschedule || undefined,
      start: databaseBooking.startTime,
      end: databaseBooking.endTime,
      duration,
      eventType: databaseBooking.eventType,
      // note(Lauris): eventTypeId is deprecated
      eventTypeId: databaseBooking.eventTypeId,
      attendees: databaseBooking.attendees.map((attendee) => ({
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.timeZone,
        language: attendee.locale,
        absent: !!attendee.noShow,
      })),
      guests: bookingResponses.guests,
      location,
      // note(Lauris): meetingUrl is deprecated
      meetingUrl: location,
      absentHost: !!databaseBooking.noShowHost,
      createdAt: databaseBooking.createdAt,
    };

    const bookingTransformed = plainToClass(BookingOutput_2024_08_13, booking, { strategy: "excludeAll" });
    // note(Lauris): I don't know why plainToClass erases bookings responses and metadata so attaching manually
    bookingTransformed.bookingFieldsResponses = bookingResponses;
    bookingTransformed.metadata = this.getUserDefinedMetadata(metadata);
    return bookingTransformed;
  }

  getUserDefinedMetadata(databaseMetadata: DatabaseMetadata) {
    if (databaseMetadata === null) return {};

    const { videoCallUrl, ...userDefinedMetadata } = databaseMetadata;

    return userDefinedMetadata;
  }

  getHost(user: DatabaseUser | null) {
    if (!user) {
      return {
        id: "unknown",
        name: "unknown",
        email: "unknown",
        username: "unknown",
      };
    }

    return {
      ...user,
      username: user.username || "unknown",
    };
  }

  async getOutputRecurringBookings(bookingsIds: number[]) {
    const transformed = [];

    for (const bookingId of bookingsIds) {
      const databaseBooking = await this.bookingsRepository.getByIdWithAttendeesAndUserAndEvent(bookingId);
      if (!databaseBooking) {
        throw new Error(`Booking with id=${bookingId} was not found in the database`);
      }

      transformed.push(this.getOutputRecurringBooking(databaseBooking));
    }

    return transformed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  getOutputRecurringBooking(databaseBooking: DatabaseBooking) {
    const dateStart = DateTime.fromISO(databaseBooking.startTime.toISOString());
    const dateEnd = DateTime.fromISO(databaseBooking.endTime.toISOString());
    const duration = dateEnd.diff(dateStart, "minutes").minutes;
    const bookingResponses = safeParse(
      bookingResponsesSchema,
      databaseBooking.responses,
      defaultBookingResponses
    );
    const metadata = safeParse(bookingMetadataSchema, databaseBooking.metadata, defaultBookingMetadata);
    const location = metadata?.videoCallUrl || databaseBooking.location;

    const booking = {
      id: databaseBooking.id,
      uid: databaseBooking.uid,
      title: databaseBooking.title,
      description: databaseBooking.description,
      hosts: [this.getHost(databaseBooking.user)],
      status: databaseBooking.status.toLowerCase(),
      cancellationReason: databaseBooking.cancellationReason || undefined,
      reschedulingReason: bookingResponses?.rescheduledReason,
      rescheduledFromUid: databaseBooking.fromReschedule || undefined,
      start: databaseBooking.startTime,
      end: databaseBooking.endTime,
      duration,
      eventType: databaseBooking.eventType,
      // note(Lauris): eventTypeId is deprecated
      eventTypeId: databaseBooking.eventTypeId,
      attendees: databaseBooking.attendees.map((attendee) => ({
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.timeZone,
        language: attendee.locale,
        absent: !!attendee.noShow,
      })),
      guests: bookingResponses.guests,
      location,
      // note(Lauris): meetingUrl is deprecated
      meetingUrl: location,
      recurringBookingUid: databaseBooking.recurringEventId,
      absentHost: !!databaseBooking.noShowHost,
      bookingFieldsResponses: databaseBooking.responses,
      createdAt: databaseBooking.createdAt,
    };

    const bookingTransformed = plainToClass(RecurringBookingOutput_2024_08_13, booking, {
      strategy: "excludeAll",
    });
    // note(Lauris): I don't know why plainToClass erases bookings responses and metadata so attaching manually
    bookingTransformed.bookingFieldsResponses = bookingResponses;
    bookingTransformed.metadata = this.getUserDefinedMetadata(metadata);
    return bookingTransformed;
  }

  getOutputCreateSeatedBooking(
    databaseBooking: DatabaseBooking,
    seatUid: string
  ): CreateSeatedBookingOutput_2024_08_13 {
    const getSeatedBookingOutput = this.getOutputSeatedBooking(databaseBooking);
    return { ...getSeatedBookingOutput, seatUid };
  }

  getOutputSeatedBooking(databaseBooking: DatabaseBooking) {
    const dateStart = DateTime.fromISO(databaseBooking.startTime.toISOString());
    const dateEnd = DateTime.fromISO(databaseBooking.endTime.toISOString());
    const duration = dateEnd.diff(dateStart, "minutes").minutes;
    const metadata = safeParse(bookingMetadataSchema, databaseBooking.metadata, defaultBookingMetadata);
    const location = metadata?.videoCallUrl || databaseBooking.location;

    const booking = {
      id: databaseBooking.id,
      uid: databaseBooking.uid,
      title: databaseBooking.title,
      description: databaseBooking.description,
      hosts: [this.getHost(databaseBooking.user)],
      status: databaseBooking.status.toLowerCase(),
      rescheduledFromUid: databaseBooking.fromReschedule || undefined,
      start: databaseBooking.startTime,
      end: databaseBooking.endTime,
      duration,
      eventType: databaseBooking.eventType,
      // note(Lauris): eventTypeId is deprecated
      eventTypeId: databaseBooking.eventTypeId,
      attendees: [],
      location,
      // note(Lauris): meetingUrl is deprecated
      meetingUrl: location,
      absentHost: !!databaseBooking.noShowHost,
      createdAt: databaseBooking.createdAt,
    };

    const parsed = plainToClass(GetSeatedBookingOutput_2024_08_13, booking, { strategy: "excludeAll" });

    // note(Lauris): I don't know why plainToClass erases booking.attendees[n].responses so attaching manually
    parsed.attendees = databaseBooking.attendees.map((attendee) => {
      const { responses } = safeParse(
        seatedBookingDataSchema,
        attendee.bookingSeat?.data,
        defaultSeatedBookingData
      );

      const attendeeData = {
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.timeZone,
        language: attendee.locale,
        absent: !!attendee.noShow,
        seatUid: attendee.bookingSeat?.referenceUid,
        bookingFieldsResponses: {},
      };
      const attendeeParsed = plainToClass(SeatedAttendee, attendeeData, { strategy: "excludeAll" });
      attendeeParsed.bookingFieldsResponses = responses || {};
      attendeeParsed.metadata = safeParse(
        seatedBookingMetadataSchema,
        attendee.bookingSeat?.metadata,
        defaultSeatedBookingMetadata
      );
      // note(Lauris): as of now email is not returned for privacy
      delete attendeeParsed.bookingFieldsResponses.email;

      return attendeeParsed;
    });

    return parsed;
  }

  async getOutputRecurringSeatedBookings(bookingsIds: number[]) {
    const transformed = [];

    for (const bookingId of bookingsIds) {
      const databaseBooking =
        await this.bookingsRepository.getByIdWithAttendeesWithBookingSeatAndUserAndEvent(bookingId);
      if (!databaseBooking) {
        throw new Error(`Booking with id=${bookingId} was not found in the database`);
      }

      transformed.push(this.getOutputRecurringSeatedBooking(databaseBooking));
    }

    return transformed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  async getOutputCreateRecurringSeatedBookings(bookings: { uid: string; seatUid: string }[]) {
    const transformed = [];

    for (const booking of bookings) {
      const databaseBooking =
        await this.bookingsRepository.getByUidWithAttendeesWithBookingSeatAndUserAndEvent(booking.uid);
      if (!databaseBooking) {
        throw new Error(`Booking with uid=${booking.uid} was not found in the database`);
      }
      transformed.push(this.getOutputCreateRecurringSeatedBooking(databaseBooking, booking.seatUid));
    }

    return transformed.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  }

  getOutputCreateRecurringSeatedBooking(
    databaseBooking: DatabaseBooking,
    seatUid: string
  ): CreateRecurringSeatedBookingOutput_2024_08_13 {
    const getRecurringSeatedBookingOutput = this.getOutputRecurringSeatedBooking(databaseBooking);
    return { ...getRecurringSeatedBookingOutput, seatUid };
  }

  getOutputRecurringSeatedBooking(databaseBooking: DatabaseBooking) {
    const dateStart = DateTime.fromISO(databaseBooking.startTime.toISOString());
    const dateEnd = DateTime.fromISO(databaseBooking.endTime.toISOString());
    const duration = dateEnd.diff(dateStart, "minutes").minutes;
    const metadata = safeParse(bookingMetadataSchema, databaseBooking.metadata, defaultBookingMetadata);
    const location = metadata?.videoCallUrl || databaseBooking.location;

    const booking = {
      id: databaseBooking.id,
      uid: databaseBooking.uid,
      title: databaseBooking.title,
      description: databaseBooking.description,
      hosts: [this.getHost(databaseBooking.user)],
      status: databaseBooking.status.toLowerCase(),
      cancellationReason: databaseBooking.cancellationReason || undefined,
      rescheduledFromUid: databaseBooking.fromReschedule || undefined,
      start: databaseBooking.startTime,
      end: databaseBooking.endTime,
      duration,
      eventType: databaseBooking.eventType,
      // note(Lauris): eventTypeId is deprecated
      eventTypeId: databaseBooking.eventTypeId,
      attendees: [],
      location,
      // note(Lauris): meetingUrl is deprecated
      meetingUrl: location,
      recurringBookingUid: databaseBooking.recurringEventId,
      absentHost: !!databaseBooking.noShowHost,
      createdAt: databaseBooking.createdAt,
    };

    const parsed = plainToClass(GetRecurringSeatedBookingOutput_2024_08_13, booking, {
      strategy: "excludeAll",
    });

    // note(Lauris): I don't know why plainToClass erases booking.attendees[n].responses so attaching manually
    parsed.attendees = databaseBooking.attendees.map((attendee) => {
      const { responses } = safeParse(
        seatedBookingDataSchema,
        attendee.bookingSeat?.data,
        defaultSeatedBookingData
      );

      const attendeeData = {
        name: attendee.name,
        email: attendee.email,
        timeZone: attendee.timeZone,
        language: attendee.locale,
        absent: !!attendee.noShow,
        seatUid: attendee.bookingSeat?.referenceUid,
        bookingFieldsResponses: {},
      };
      const attendeeParsed = plainToClass(SeatedAttendee, attendeeData, { strategy: "excludeAll" });
      attendeeParsed.bookingFieldsResponses = responses || {};
      attendeeParsed.metadata = safeParse(
        seatedBookingMetadataSchema,
        attendee.bookingSeat?.metadata,
        defaultSeatedBookingMetadata
      );
      // note(Lauris): as of now email is not returned for privacy
      delete attendeeParsed.bookingFieldsResponses.email;
      return attendeeParsed;
    });

    return parsed;
  }

  getOutputReassignedBooking(
    databaseBooking: Pick<BookingWithUser, "uid" | "user">
  ): ReassignBookingOutput_2024_08_13 {
    return {
      bookingUid: databaseBooking.uid,
      reassignedTo: {
        id: databaseBooking?.user?.id || 0,
        name: databaseBooking?.user?.name || "unknown",
        email: databaseBooking?.user?.email || "unknown",
      },
    };
  }
}